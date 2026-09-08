import { NextResponse } from 'next/server';
import { enrichPosts } from '../../../lib/scoring';

const API = 'https://graph.threads.net/v1.0';

const demoPosts = (username) =>
  enrichPosts([
    {
      id: 'demo-1',
      username,
      text: 'Most freelancers do not need another skill. They need proof that makes the skill easy to buy.',
      timestamp: '2026-09-06T06:30:00Z',
      permalink: 'https://www.threads.com',
      likes: 1840,
      replies: 218,
      reposts: 331,
      quotes: 91,
      views: null,
    },
    {
      id: 'demo-2',
      username,
      text: 'Your portfolio is not a gallery. It is a sales argument.',
      timestamp: '2026-09-04T11:00:00Z',
      permalink: 'https://www.threads.com',
      likes: 730,
      replies: 61,
      reposts: 82,
      quotes: 24,
      views: null,
    },
    {
      id: 'demo-3',
      username,
      text: 'I wasted months changing my Upwork profile when the real problem was the offer.',
      timestamp: '2026-09-02T04:10:00Z',
      permalink: 'https://www.threads.com',
      likes: 3620,
      replies: 447,
      reposts: 615,
      quotes: 140,
      views: null,
    },
  ]);

class ThreadsApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ThreadsApiError';
    this.status = details.status || 500;
    this.apiCode = details.apiCode ?? null;
    this.apiSubcode = details.apiSubcode ?? null;
    this.apiType = details.apiType ?? null;
    this.fbtraceId = details.fbtraceId ?? null;
  }
}

async function threadsFetch(path, params = {}, token) {
  const url = new URL(`${API}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set('access_token', token);

  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  const raw = await response.text();
  let json;

  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new ThreadsApiError('Threads API returned a non-JSON response.', {
      status: response.status,
    });
  }

  if (!response.ok || json?.error) {
    const apiError = json?.error || {};
    throw new ThreadsApiError(
      apiError.message || `Threads API request failed (${response.status}).`,
      {
        status: response.status,
        apiCode: apiError.code,
        apiSubcode: apiError.error_subcode,
        apiType: apiError.type,
        fbtraceId: apiError.fbtrace_id,
      }
    );
  }

  return json;
}

function apiErrorResponse(error, stage) {
  const permissionError = error?.apiCode === 10 || error?.status === 403;

  return NextResponse.json(
    {
      error: permissionError
        ? `Meta blocked "${stage}" because this app/token does not currently have the required access.`
        : error?.message || 'Threads API request failed.',
      stage,
      meta: {
        code: error?.apiCode ?? null,
        subcode: error?.apiSubcode ?? null,
        type: error?.apiType ?? null,
        trace: error?.fbtraceId ?? null,
      },
      nextStep: permissionError
        ? 'Token is connected, but public-profile research requires threads_profile_discovery access for this app. This is an access-level issue, not a Vercel or UI bug.'
        : 'Check the token status with /api/threads?health=1.',
    },
    { status: permissionError ? 403 : 502 }
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const username = (searchParams.get('username') || '')
    .replace(/^@/, '')
    .trim();
  const demo = searchParams.get('demo') === '1';
  const health = searchParams.get('health') === '1';
  const token = process.env.THREADS_ACCESS_TOKEN;

  if (!token) {
    if (health) {
      return NextResponse.json(
        {
          ok: false,
          mode: 'no-token',
          error: 'THREADS_ACCESS_TOKEN is not configured on this deployment.',
        },
        { status: 503 }
      );
    }

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      mode: 'demo',
      profile: {
        username,
        name: username,
        threads_biography:
          'Demo data — add THREADS_ACCESS_TOKEN for live mode.',
      },
      posts: demoPosts(username),
    });
  }

  if (health) {
    try {
      const me = await threadsFetch(
        '/me',
        {
          fields:
            'id,username,name,threads_profile_picture_url,threads_biography',
        },
        token
      );

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
    } catch (error) {
      return apiErrorResponse(error, 'token health check');
    }
  }

  if (!username) {
    return NextResponse.json(
      { error: 'Username is required.' },
      { status: 400 }
    );
  }

  if (demo) {
    return NextResponse.json({
      mode: 'demo',
      profile: {
        username,
        name: username,
        threads_biography: 'Demo data.',
      },
      posts: demoPosts(username),
    });
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
    return apiErrorResponse(error, 'token validation');
  }

  if ((me.username || '').toLowerCase() === username.toLowerCase()) {
    try {
      const feed = await threadsFetch(
        '/me/threads',
        {
          fields:
            'id,media_type,permalink,username,text,timestamp,shortcode,is_quote_post,has_replies',
          limit: 100,
        },
        token
      );

      const posts = (feed.data || []).map((p) => ({
        ...p,
        likes: null,
        replies: null,
        reposts: null,
        quotes: null,
        views: null,
      }));

      return NextResponse.json({
        mode: 'live-own-account',
        profile: me,
        posts: enrichPosts(posts),
      });
    } catch (error) {
      return apiErrorResponse(error, 'own profile posts');
    }
  }

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
    return apiErrorResponse(error, 'public profile lookup');
  }

  try {
    const feed = await threadsFetch(
      '/profile_posts',
      {
        username,
        fields:
          'id,media_type,permalink,username,text,timestamp,shortcode,is_quote_post,has_replies',
        limit: 100,
      },
      token
    );

    const posts = (feed.data || []).map((p) => ({
      ...p,
      likes: null,
      replies: null,
      reposts: null,
      quotes: null,
      views: null,
    }));

    return NextResponse.json({
      mode: 'live-public-profile',
      profile,
      posts: enrichPosts(posts),
    });
  } catch (error) {
    return apiErrorResponse(error, 'public profile posts');
  }
}
