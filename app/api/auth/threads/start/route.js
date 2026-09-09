import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { oauthConfig } from '../../../../../lib/threads-oauth';
import { setOAuthStateCookie } from '../../../../../lib/threads-session';

export const runtime = 'nodejs';

const SCOPES = [
  'threads_basic',
  'threads_profile_discovery',
  'threads_manage_insights',
];

export async function GET(request) {
  const { appId, redirectUri, missing } = oauthConfig();
  if (missing.length) {
    const target = new URL('/', request.url);
    target.searchParams.set('oauth_error', 'config_missing');
    target.searchParams.set('missing', missing.join(','));
    return NextResponse.redirect(target);
  }

  const state = crypto.randomBytes(24).toString('hex');
  const authorize = new URL('https://threads.net/oauth/authorize');
  authorize.searchParams.set('client_id', appId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', SCOPES.join(','));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('state', state);

  const response = NextResponse.redirect(authorize);
  setOAuthStateCookie(response, state);
  return response;
}
