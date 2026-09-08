import { NextResponse } from 'next/server';
import { enrichPosts } from '../../../lib/scoring';

const API = 'https://graph.threads.net/v1.0';
const POST_FIELDS = 'id,media_type,permalink,username,text,timestamp,shortcode,is_quote_post,has_replies';
const INSIGHT_METRICS = 'views,likes,replies,reposts,quotes';

async function threadsFetch(path, params, token) {
  const url = new URL(`${API}${path}`);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  url.searchParams.set('access_token', token);

  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  const raw = await response.text();
  let json = {};

  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error('Threads API returned an invalid response.');
    error.status = response.status;
    throw error;
  }

  if (!response.ok || json?.error) {
    const apiError = json?.error || {};
    const error = new Error(
      apiError.message || `Threads API request failed (${response.status}).`
    );

    error.status = response.status;
    error.code = apiError.code ?? null;
    error.subcode = apiError.error_subcode ?? null;
    error.type = apiError.type ?? null;
    error.trace = apiError.fbtrace_id ?? null;
    throw error;
  }

  return json;
}

function metricValue(metric) {
  if (!metric) return null;

  if (typeof metric?.total_value?.value === 'number') {
    return metric.total_value.value;
  }

  if (
    Array.isArray(metric?.values) &&
    typeof metric.values[0]?.value === 'number'
  ) {
    return metric.values[0].value;
  }

  return null;
}

function parseInsights(data = []) {
  const metrics = Object.fromEntries(
    data
      .filter((item) => item?.name)
      .map((item) => [item.name, item])
  );

  return {
    views: metricValue(metrics.views),
    likes: metricValue(metrics.likes),
    replies: metricValue(metrics.replies),
    reposts: metricValue(metrics.reposts),
    quotes: metricValue(metrics.quotes),
  };
}

function errorResponse(error, stage) {
  const permissionError =
    error?.status === 403 ||
    error?.code === 10 ||
    error?.code === 200;

  return NextResponse.json(
    {
      error: error?.message || 'Threads API request failed.',
      stage,
      meta: {
        code: error?.code ?? null,
        subcode: error?.subcode ?? null,
        type: error?.type ?? null,
        trace: error?.trace ?? null,
      },
      nextStep:
        stage === 'post insights'
          ? 'Regenerate the Threads token with threads_manage_insights, replace THREADS_ACCESS_TOKEN in Vercel, then redeploy.'
          : 'Check /api/threads?health=1 to verify the token.',
    },
    { status: permissionError ? 403 : 502 }
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const username = (searchParams.get('username') || '')
    .replace(/^@/, '')
    .trim();

  const health = searchParams.get('health') === '1';
  const token = process.env.THREADS_ACCESS_TOKEN;

  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        mode: 'no-token',
        error: 'THREADS_ACCESS_TOKEN is not configured on this deployment.',
      },
      { status: 503 }
    );
  }

  let me;

  try {
    me = await threadsFetch(
      '/me',
      {
        fields:
          'id,username,name,threads_profile_picture_url,threads_biography',
      },
      token
    );
  } catch (error) {
    return errorResponse(error, 'token validation');
  }

  if (health) {
    return NextResponse.json({
      ok: true,
      mode: 'live',
      message: 'Threads token is valid.',
      profile: {
        id: me.id,
        username: me.username,
        name: me.name,
      },
    });
  }

  if (!username) {
    return NextResponse.json(
      { error: 'Username is required.' },
      { status: 400 }
    );
  }

  // Own account: fetch posts and official post-level insights.
  if ((me.username || '').toLowerCase() === username.toLowerCase()) {
    let feed;

    try {
      feed = await threadsFetch(
        '/me/threads',
        {
          fields: POST_FIELDS,
          limit: 25,
        },
        token
      );
    } catch (error) {
      return errorResponse(error, 'own profile posts');
    }

    const rawPosts = feed.data || [];

    const insightResults = await Promise.allSettled(
      rawPosts.map(async (post) => {
        const insightJson = await threadsFetch(
          `/${post.id}/insights`,
          {
            metric: INSIGHT_METRICS,
          },
          token
        );

        return {
          ...post,
          ...parseInsights(insightJson.data || []),
        };
      })
    );

    const posts = [];
    const insightErrors = [];

    insightResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        posts.push(result.value);
      } else {
        const post = rawPosts[index];

        posts.push({
          ...post,
          views: null,
          likes: null,
          replies: null,
          reposts: null,
          quotes: null,
        });

        insightErrors.push({
          postId: post.id,
          message:
            result.reason?.message || 'Unable to load post insights.',
          code: result.reason?.code ?? null,
          status: result.reason?.status ?? null,
        });
      }
    });

    if (
      rawPosts.length > 0 &&
      insightErrors.length === rawPosts.length
    ) {
      return NextResponse.json(
        {
          error:
            'Posts loaded, but Meta did not allow post insights for this token.',
          stage: 'post insights',
          meta: insightErrors[0],
          nextStep:
            'Regenerate the Threads token with threads_manage_insights, replace THREADS_ACCESS_TOKEN in Vercel, then redeploy.',
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      mode: 'live-own-account',
      profile: me,
      insights: {
        requested: rawPosts.length,
        loaded: rawPosts.length - insightErrors.length,
        failed: insightErrors.length,
      },
      posts: enrichPosts(posts),
    });
  }

  // Public account research.
  // We load public posts, but do not request owner-only post insights.
  let profile;

  try {
    profile = await threadsFetch(
      '/profile_lookup',
      {
        username,
        fields:
          'id,username,name,threads_profile_picture_url,threads_biography,is_verified',
      },
      token
    );
  } catch (error) {
    return errorResponse(error, 'public profile lookup');
  }

  try {
    const feed = await threadsFetch(
      '/profile_posts',
      {
        username,
        fields: POST_FIELDS,
        limit: 50,
      },
      token
    );

    const posts = (feed.data || []).map((post) => ({
      ...post,
      views: null,
      likes: null,
      replies: null,
      reposts: null,
      quotes: null,
    }));

    return NextResponse.json({
      mode: 'live-public-profile',
      profile,
      note:
        'Public posts loaded. Owner-only post insights are intentionally not requested for competitor accounts.',
      posts: enrichPosts(posts),
    });
  } catch (error) {
    return errorResponse(error, 'public profile posts');
  }
}
