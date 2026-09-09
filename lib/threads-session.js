import crypto from 'crypto';
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'threads_scout_oauth_v1';
const STATE_COOKIE = 'threads_scout_oauth_state_v1';

function encryptionKey() {
  const secret = process.env.THREADS_APP_SECRET;
  if (!secret) throw new Error('THREADS_APP_SECRET is not configured.');
  return crypto.createHash('sha256').update(secret).digest();
}

export function sealSession(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function openSession(value) {
  if (!value) return null;
  try {
    const packed = Buffer.from(value, 'base64url');
    if (packed.length < 29) return null;
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

export async function readOAuthSession() {
  const store = await cookies();
  return openSession(store.get(SESSION_COOKIE)?.value || '');
}

export async function getThreadsCredential() {
  const session = await readOAuthSession();
  if (session?.accessToken) {
    return {
      token: session.accessToken,
      source: 'oauth',
      session,
    };
  }

  const envToken = process.env.THREADS_ACCESS_TOKEN;
  if (envToken) {
    return {
      token: envToken,
      source: 'environment',
      session: null,
    };
  }

  return { token: null, source: 'none', session: null };
}

export function setOAuthSessionCookie(response, payload, maxAgeSeconds) {
  response.cookies.set(SESSION_COOKIE, sealSession(payload), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(300, Number(maxAgeSeconds || 3600)),
  });
}

export function clearOAuthSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function setOAuthStateCookie(response, state) {
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
}

export async function readOAuthStateCookie() {
  const store = await cookies();
  return store.get(STATE_COOKIE)?.value || null;
}

export function clearOAuthStateCookie(response) {
  response.cookies.set(STATE_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
