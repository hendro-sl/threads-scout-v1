import { NextResponse } from 'next/server';
import { enrichPosts } from '../../../lib/scoring';

const API = 'https://graph.threads.net/v1.0';
const POST_FIELDS =
  'id,media_type,permalink,username,text,timestamp,shortcode,is_quote_post,has_replies';
const INSIGHT_METRICS = 'views,likes,replies,reposts,quotes';
const MAX_POSTS = 100;
const PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 12000;
const RETRY_DELAYS_MS = [0, 600, 1400];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanUsername(value = '') {
  return String(value).replace(/^@/, '').trim();
}

function requestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function demoPosts(username) {
  return enrichPosts([
    {
      id: 'demo-1',
      username,
      text: 'Most freelancers do not need another skill. They need proof that makes the skill easy to buy.',
      timestamp: '2026-09-06T06:30:00Z',
      permalink: 'https://www.threads.com',
      media_type: 'TEXT_POST',
      likes: 1840,
      replies: 218,
      reposts: 331,
      quotes: 91,
      views: 28900,
    },
    {
      id: 'demo-2',
      username,
      text: 'Your portfolio is not a gallery. It is a sales argument.',
      timestamp: '2026-09-04T11:00:00Z',
      permalink: 'https://www.threads.com',
      media_type: 'TEXT_POST',
      likes: 730,
      replies: 61,
      reposts: 82,
      quotes: 24,
      views: 9200,
    },
    {
      id: 'demo-3',
      username,
      text: 'I wasted months changing my Upwork profile when the real problem was the offer.',
      timestamp: '2026-09-02T04:10:00Z',
      permalink: 'https://www.threads.com',
      media_type: 'TEXT_POST',
      likes: 3620,
      replies: 447,
      reposts: 615,
      quotes: 140,
      views: 51800,
    },
  ]);
}

function makeMetaError(message, details = {}) {
  const error = new Error(message || 'Threads API request failed.');
  Object.assign(error, details);
  return error;
}

function shouldRetry(error) {
  if (error?.name === 'AbortError') return true;
  if (error?.networkError) return true;
  if (error?.httpStatus === 429) return true;
  if (Number(error?.httpStatus) >= 500) return true;
  if ([4, 17, 32, 613].includes(Number(error?.metaCode))) return true;
  return false;
}

async function threadsFetch(path, params = {}, token) {
  let lastError;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt]) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }

    const url = new URL(`${API}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set('access_token', token);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      const raw = await response.text();
      let json = {};

      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {
        throw makeMetaError('Threads API returned an invalid response.', {
          httpStatus: response.status,
        });
      }

      if (!response.ok || json?.error) {
        const apiError = json?.error || {};
        throw makeMetaError(
          apiError.message || `Threads API request failed (${response.status}).`,
          {
            httpStatus: response.status,
            metaCode: apiError.code ?? null,
            metaSubcode: apiError.error_subcode ?? null,
            metaType: apiError.type ?? null,
            trace: apiError.fbtrace_id ?? null,
          }
        );
      }

      return json;
    } catch (error) {
      if (error?.name === 'AbortError') {
        lastError = makeMetaError('Threads API request timed out.', {
          httpStatus: 504,
          timedOut: true,
        });
      } else if (
        error instanceof TypeError &&
        !('httpStatus' in error)
      ) {
        lastError = makeMetaError('Unable to reach Threads API.', {
          httpStatus: 502,
          networkError: true,
        });
      } else {
        lastError = error;
      }

      if (!shouldRetry(lastError) || attempt === RETRY_DELAYS_MS.length - 1) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || makeMetaError('Threads API request failed.');
}

function classifyError(error, stage, id) {
  const status = Number(error?.httpStatus || 0);
  const code = Number(error?.metaCode || 0);
  const message = String(error?.message || '');
  const lower = message.toLowerCase();

  let payload = {
    code: 'THREADS_API_ERROR',
    title: 'Threads API error',
    message: 'Threads could not complete this request.',
    action: 'Retry the request. If it continues, check the diagnostics below.',
    retryable: false,
    stage,
    requestId: id,
  };
  let httpStatus = 502;

  if (status === 401 || code === 190) {
    payload = {
      ...payload,
      code: 'TOKEN_INVALID',
      title: 'Threads token needs attention',
      message: 'The current Threads access token is invalid or expired.',
      action: 'Generate a new Threads access token, replace THREADS_ACCESS_TOKEN in Vercel, then redeploy.',
    };
    httpStatus = 401;
  } else if (status === 403 || code === 10 || code === 200) {
    payload = {
      ...payload,
      code: 'PERMISSION_REQUIRED',
      title: 'Permission required',
      message: 'The token is connected, but Meta has not allowed this operation for the current app/token.',
      action: 'Check the Threads permission required for this feature. Do not change Vercel unless the token itself changed.',
    };
    httpStatus = 403;
  } else if (status === 429 || [4, 17, 32, 613].includes(code)) {
    payload = {
      ...payload,
      code: 'RATE_LIMITED',
      title: 'Threads API is rate-limiting requests',
      message: 'Too many requests were sent in a short period. Threads Scout already retried automatically.',
      action: 'Wait a moment, then use Retry.',
      retryable: true,
    };
    httpStatus = 429;
  } else if (error?.timedOut) {
    payload = {
      ...payload,
      code: 'META_TIMEOUT',
      title: 'Threads API timed out',
      message: 'Meta did not respond within the expected time. Threads Scout already retried automatically.',
      action: 'Use Retry. No settings change is needed.',
      retryable: true,
    };
    httpStatus = 504;
  } else if (error?.networkError) {
    payload = {
      ...payload,
      code: 'NETWORK_ERROR',
      title: 'Could not reach Threads',
      message: 'The server could not reach the Threads API.',
      action: 'Use Retry. If it persists, check Vercel status and Meta API status.',
      retryable: true,
    };
    httpStatus = 502;
  } else if (status >= 500) {
    payload = {
      ...payload,
      code: 'META_TEMPORARY_ERROR',
      title: 'Threads API temporarily failed',
      message: 'Meta returned a server error. Threads Scout already retried automatically.',
      action: 'Use Retry later. Do not rotate tokens or change code just because of this error.',
      retryable: true,
    };
    httpStatus = 502;
  } else if (
    status === 400 &&
    (lower.includes('username') ||
      lower.includes('not found') ||
      lower.includes('does not exist') ||
      lower.includes('profile'))
  ) {
    payload = {
      ...payload,
      code: 'ACCOUNT_UNAVAILABLE',
      title: 'Account could not be loaded',
      message: 'Threads could not return this public account. The username may be wrong, unavailable, private/restricted, or inaccessible to this app.',
      action: 'Check the exact Threads username and try another known-public account.',
    };
    httpStatus = 404;
  } else if (status === 400) {
    payload = {
      ...payload,
      code: 'BAD_REQUEST',
      title: 'Threads rejected the request',
      message: 'Meta rejected one of the request parameters.',
      action: 'This is usually an API compatibility issue. Keep the Request ID and update the integration before changing credentials.',
    };
    httpStatus = 400;
  }

  return { payload, httpStatus };
}

function errorResponse(error, stage, id) {
  const { payload, httpStatus } = classifyError(error, stage, id);

  console.error('[Threads Scout]', {
    requestId: id,
    stage,
    httpStatus: error?.httpStatus ?? null,
    metaCode: error?.metaCode ?? null,
    metaSubcode: error?.metaSubcode ?? null,
    metaType: error?.metaType ?? null,
    trace: error?.trace ?? null,
  });

  return NextResponse.json(
    {
      ok: false,
      error: payload,
      diagnostics: {
        metaHttpStatus: error?.httpStatus ?? null,
        metaCode: error?.metaCode ?? null,
        metaSubcode: error?.metaSubcode ?? null,
        metaType: error?.metaType ?? null,
        trace: error?.trace ?? null,
      },
    },
    { status: httpStatus }
  );
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
  const map = Object.fromEntries(
    data.filter((item) => item?.name).map((item) => [item.name, item])
  );

  return {
    views: metricValue(map.views),
    likes: metricValue(map.likes),
    replies: metricValue(map.replies),
    reposts: metricValue(map.reposts),
    quotes: metricValue(map.quotes),
  };
}

async function fetchPosts(path, params, token) {
  const posts = [];
  let after = null;

  while (posts.length < MAX_POSTS) {
    const page = await threadsFetch(
      path,
      {
        ...params,
        fields: POST_FIELDS,
        limit: Math.min(PAGE_SIZE, MAX_POSTS - posts.length),
        after,
      },
      token
    );

    const data = Array.isArray(page?.data) ? page.data : [];
    posts.push(...data);

    const nextAfter = page?.paging?.cursors?.after || null;
    if (!nextAfter || data.length === 0 || nextAfter === after) break;
    after = nextAfter;
  }

  const seen = new Set();
  return posts.filter((post) => {
    if (!post?.id || seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = { ok: true, value: await mapper(items[index], index) };
      } catch (error) {
        output[index] = { ok: false, error };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length || 1) },
    () => worker()
  );
  await Promise.all(workers);
  return output;
}

function publicPostShape(post) {
  return {
    ...post,
    views: null,
    likes: null,
    replies: null,
    reposts: null,
    quotes: null,
  };
}

export async function GET(request) {
  const id = requestId();
  const { searchParams } = new URL(request.url);
  const username = cleanUsername(searchParams.get('username'));
  const health = searchParams.get('health') === '1';
  const forceDemo = searchParams.get('demo') === '1';
  const token = process.env.THREADS_ACCESS_TOKEN;

  if (forceDemo) {
    const demoName = username || 'demo_creator';
    const posts = demoPosts(demoName);
    return NextResponse.json({
      ok: true,
      requestId: id,
      mode: 'demo',
      profile: { username: demoName, name: 'Demo Creator' },
      capabilities: {
        accountType: 'demo',
        postMetrics: 'full',
        viralRanking: true,
        publicResearch: true,
      },
      posts,
      warnings: [],
    });
  }

  if (!token) {
    if (health) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'CONFIG_MISSING',
            title: 'Threads token is not configured',
            message: 'THREADS_ACCESS_TOKEN is missing from this deployment.',
            action: 'Add the token in Vercel Environment Variables and redeploy.',
            retryable: false,
            stage: 'configuration',
            requestId: id,
          },
        },
        { status: 503 }
      );
    }

    const demoName = username || 'demo_creator';
    return NextResponse.json({
      ok: true,
      requestId: id,
      mode: 'demo-no-token',
      profile: { username: demoName, name: 'Demo Creator' },
      capabilities: {
        accountType: 'demo',
        postMetrics: 'full',
        viralRanking: true,
        publicResearch: false,
      },
      posts: demoPosts(demoName),
      warnings: [
        {
          code: 'CONFIG_MISSING',
          message: 'Showing demo data because THREADS_ACCESS_TOKEN is not configured.',
        },
      ],
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
    return errorResponse(error, 'token_validation', id);
  }

  if (health) {
    return NextResponse.json({
      ok: true,
      requestId: id,
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
      {
        ok: false,
        error: {
          code: 'USERNAME_REQUIRED',
          title: 'Enter a Threads username',
          message: 'A username is required before Threads Scout can research an account.',
          action: 'Enter the exact username without the @ symbol.',
          retryable: false,
          stage: 'validation',
          requestId: id,
        },
      },
      { status: 400 }
    );
  }

  const isOwnAccount =
    String(me.username || '').toLowerCase() === username.toLowerCase();

  if (isOwnAccount) {
    let rawPosts;
    try {
      rawPosts = await fetchPosts('/me/threads', {}, token);
    } catch (error) {
      return errorResponse(error, 'own_posts', id);
    }

    const insightResults = await mapWithConcurrency(
      rawPosts,
      4,
      async (post) => {
        const response = await threadsFetch(
          `/${post.id}/insights`,
          { metric: INSIGHT_METRICS },
          token
        );
        return { ...post, ...parseInsights(response?.data || []) };
      }
    );

    const posts = [];
    const insightFailures = [];

    insightResults.forEach((result, index) => {
      if (result?.ok) {
        posts.push(result.value);
      } else {
        posts.push(publicPostShape(rawPosts[index]));
        insightFailures.push(result?.error);
      }
    });

    const loadedInsights = rawPosts.length - insightFailures.length;
    const metricsState =
      rawPosts.length === 0
        ? 'none'
        : loadedInsights === rawPosts.length
          ? 'full'
          : loadedInsights > 0
            ? 'partial'
            : 'none';

    const warnings = [];
    if (metricsState !== 'full' && rawPosts.length > 0) {
      const firstError = insightFailures[0];
      const classified = classifyError(firstError, 'post_insights', id).payload;
      warnings.push({
        code: 'INSIGHTS_PARTIAL',
        message:
          metricsState === 'partial'
            ? `Insights loaded for ${loadedInsights} of ${rawPosts.length} posts.`
            : 'Posts loaded successfully, but post insights are not available to this token.',
        action: classified.action,
      });
    }

    const enriched = enrichPosts(posts);
    const rankableCount = enriched.filter(
      (post) => post.viralIndex !== null && post.viralIndex !== undefined
    ).length;

    return NextResponse.json({
      ok: true,
      requestId: id,
      mode: 'live-own-account',
      profile: me,
      capabilities: {
        accountType: 'own',
        postMetrics: metricsState,
        viralRanking: rankableCount >= 3,
        publicResearch: true,
      },
      insights: {
        requested: rawPosts.length,
        loaded: loadedInsights,
        failed: insightFailures.length,
      },
      posts: enriched,
      warnings,
    });
  }

  // Public research is content-first. profile_posts is the required call;
  // profile_lookup is optional enrichment and never blocks loaded posts.
  let rawPosts;
  try {
    rawPosts = await fetchPosts('/profile_posts', { username }, token);
  } catch (error) {
    return errorResponse(error, 'public_posts', id);
  }

  const posts = enrichPosts(rawPosts.map(publicPostShape));
  const warnings = [];
  let profile = {
    username: rawPosts[0]?.username || username,
    name: rawPosts[0]?.username || username,
  };

  try {
    // Meta's official example documents username as the lookup parameter.
    // Do not add optional fields here: profile lookup must not block research.
    const lookup = await threadsFetch('/profile_lookup', { username }, token);
    if (lookup && typeof lookup === 'object') {
      profile = {
        ...profile,
        ...lookup,
        username: lookup.username || profile.username,
      };
    }
  } catch (error) {
    const classified = classifyError(error, 'public_profile', id).payload;
    warnings.push({
      code: 'PROFILE_ENRICHMENT_FAILED',
      message: 'Posts loaded, but extra public-profile details could not be loaded.',
      action: classified.retryable
        ? 'No action is required; retry later if you need the extra profile details.'
        : 'No action is required for content research.',
    });
  }

  return NextResponse.json({
    ok: true,
    requestId: id,
    mode: 'live-public-profile',
    profile,
    capabilities: {
      accountType: 'public',
      postMetrics: 'none',
      viralRanking: false,
      publicResearch: true,
    },
    posts,
    warnings,
    note:
      'Public post content is available, but owner-only post insights are not used for competitor accounts.',
  });
}
