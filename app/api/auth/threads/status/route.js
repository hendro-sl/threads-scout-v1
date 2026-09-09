import { NextResponse } from 'next/server';
import { debugUserToken, getMe, oauthConfig } from '../../../../../lib/threads-oauth';
import { getThreadsCredential } from '../../../../../lib/threads-session';

export const runtime = 'nodejs';

export async function GET() {
  const { missing } = oauthConfig();
  const credential = await getThreadsCredential();

  if (!credential.token) {
    return NextResponse.json({
      ok: true,
      connected: false,
      source: 'none',
      oauthConfigured: missing.length === 0,
      missingConfig: missing,
      scopes: [],
      scopesKnown: false,
      discoveryReady: false,
    });
  }

  let me = null;
  let valid = true;
  let tokenError = null;

  try {
    me = await getMe(credential.token);
  } catch (error) {
    valid = false;
    tokenError = {
      status: error?.status ?? null,
      code: error?.code ?? null,
      message: error?.message || 'Token validation failed.',
    };
  }

  let scopes = credential.session?.scopes || [];
  let scopesKnown = Boolean(credential.session?.scopesKnown);
  let expiresAt = credential.session?.expiresAt || null;

  if (valid && missing.length === 0) {
    try {
      const debug = await debugUserToken(credential.token);
      if (Array.isArray(debug?.scopes)) {
        scopes = debug.scopes;
        scopesKnown = true;
      }
      if (Number(debug?.expires_at) > 0) expiresAt = Number(debug.expires_at) * 1000;
      if (debug?.is_valid === false) valid = false;
    } catch {
      // The research API can still work when token-debug is temporarily unavailable.
    }
  }

  return NextResponse.json({
    ok: true,
    connected: valid,
    source: credential.source,
    oauthConfigured: missing.length === 0,
    missingConfig: missing,
    profile: me
      ? { id: me.id, username: me.username, name: me.name }
      : credential.session
        ? {
            id: credential.session.userId || null,
            username: credential.session.username || null,
            name: credential.session.name || null,
          }
        : null,
    scopes,
    scopesKnown,
    discoveryReady: scopesKnown
      ? scopes.includes('threads_profile_discovery')
      : null,
    insightsReady: scopesKnown
      ? scopes.includes('threads_manage_insights')
      : null,
    expiresAt,
    tokenError,
  });
}
