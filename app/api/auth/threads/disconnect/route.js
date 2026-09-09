import { NextResponse } from 'next/server';
import { clearOAuthSessionCookie } from '../../../../../lib/threads-session';

export const runtime = 'nodejs';

export async function POST(request) {
  const response = NextResponse.json({ ok: true, disconnected: true });
  clearOAuthSessionCookie(response);
  return response;
}
