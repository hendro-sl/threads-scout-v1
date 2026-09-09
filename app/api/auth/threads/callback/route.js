import { NextResponse } from 'next/server';
import {
  debugUserToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getMe,
} from '../../../../../lib/threads-oauth';
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setOAuthSessionCookie,
} from '../../../../../lib/threads-session';

export const runtime = 'nodejs';

function homeRedirect(request, params = {}) {
  const target = new URL('/', request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
  }
  return target;
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return NextResponse.redirect(homeRedirect(request, { oauth_error: 'authorization_denied' }));
  }

  const expectedState = await readOAuthStateCookie();
  if (!code || !state || !expectedState || state !== expectedState) {
    const response = NextResponse.redirect(homeRedirect(request, { oauth_error: 'state_mismatch' }));
    clearOAuthStateCookie(response);
    return response;
  }

  try {
    const short = await exchangeCodeForToken(code);
    if (!short?.access_token) throw new Error('Meta did not return a short-lived access token.');

    let token = short.access_token;
    let expiresIn = 3600;
    let tokenKind = 'short';

    try {
      const long = await exchangeForLongLivedToken(short.access_token);
      if (long?.access_token) {
        token = long.access_token;
        expiresIn = Number(long.expires_in || 5184000);
        tokenKind = 'long';
      }
    } catch (error) {
      console.warn('[Threads Scout OAuth] Long-lived exchange failed; using short token.', {
        status: error?.status ?? null,
        code: error?.code ?? null,
      });
    }

    const me = await getMe(token);
    let scopes = [];
    let scopesKnown = false;
    let expiresAt = Date.now() + expiresIn * 1000;

    try {
      const debug = await debugUserToken(token);
      scopes = Array.isArray(debug?.scopes) ? debug.scopes : [];
      scopesKnown = Array.isArray(debug?.scopes);
      if (Number(debug?.expires_at) > 0) expiresAt = Number(debug.expires_at) * 1000;
    } catch (error) {
      console.warn('[Threads Scout OAuth] Token debug unavailable.', {
        status: error?.status ?? null,
        code: error?.code ?? null,
      });
    }

    const response = NextResponse.redirect(
      homeRedirect(request, {
        oauth: 'connected',
        discovery: scopesKnown
          ? scopes.includes('threads_profile_discovery') ? '1' : '0'
          : 'unknown',
      })
    );

    setOAuthSessionCookie(
      response,
      {
        accessToken: token,
        tokenKind,
        connectedAt: Date.now(),
        expiresAt,
        userId: me?.id || short?.user_id || null,
        username: me?.username || null,
        name: me?.name || null,
        scopes,
        scopesKnown,
      },
      Math.max(300, Math.floor((expiresAt - Date.now()) / 1000))
    );
    clearOAuthStateCookie(response);
    return response;
  } catch (error) {
    console.error('[Threads Scout OAuth callback]', {
      message: error?.message,
      status: error?.status ?? null,
      code: error?.code ?? null,
      subcode: error?.subcode ?? null,
    });
    const response = NextResponse.redirect(homeRedirect(request, { oauth_error: 'token_exchange_failed' }));
    clearOAuthStateCookie(response);
    return response;
  }
}
