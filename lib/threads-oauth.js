const GRAPH = 'https://graph.threads.net';

async function readJson(response) {
  const raw = await response.text();
  let json = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error(`Threads returned an unreadable response (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  if (!response.ok || json?.error) {
    const apiError = json?.error || {};
    const error = new Error(apiError.message || `Threads request failed (${response.status}).`);
    error.status = response.status;
    error.code = apiError.code ?? null;
    error.subcode = apiError.error_subcode ?? null;
    error.type = apiError.type ?? null;
    throw error;
  }

  return json;
}

export function oauthConfig() {
  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  const redirectUri = process.env.THREADS_REDIRECT_URI;
  const missing = [];
  if (!appId) missing.push('THREADS_APP_ID');
  if (!appSecret) missing.push('THREADS_APP_SECRET');
  if (!redirectUri) missing.push('THREADS_REDIRECT_URI');
  return { appId, appSecret, redirectUri, missing };
}

export async function exchangeCodeForToken(code) {
  const { appId, appSecret, redirectUri, missing } = oauthConfig();
  if (missing.length) throw new Error(`Missing OAuth config: ${missing.join(', ')}`);

  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  url.searchParams.set('redirect_uri', redirectUri);

  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return readJson(response);
}

export async function exchangeForLongLivedToken(shortToken) {
  const { appSecret, missing } = oauthConfig();
  if (missing.length) throw new Error(`Missing OAuth config: ${missing.join(', ')}`);

  const url = new URL(`${GRAPH}/access_token`);
  url.searchParams.set('grant_type', 'th_exchange_token');
  url.searchParams.set('client_secret', appSecret);

  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${shortToken}`,
    },
  });
  return readJson(response);
}

export async function getMe(token) {
  const url = new URL(`${GRAPH}/v1.0/me`);
  url.searchParams.set('fields', 'id,username,name,threads_profile_picture_url,threads_biography');
  url.searchParams.set('access_token', token);
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return readJson(response);
}

export async function getAppAccessToken() {
  const { appId, appSecret, missing } = oauthConfig();
  if (missing.length) throw new Error(`Missing OAuth config: ${missing.join(', ')}`);

  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set('grant_type', 'client_credentials');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const json = await readJson(response);
  return json.access_token;
}

export async function debugUserToken(userToken) {
  const appToken = await getAppAccessToken();
  const url = new URL(`${GRAPH}/debug_token`);
  url.searchParams.set('input_token', userToken);
  url.searchParams.set('access_token', appToken);

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const json = await readJson(response);
  return json?.data || {};
}
