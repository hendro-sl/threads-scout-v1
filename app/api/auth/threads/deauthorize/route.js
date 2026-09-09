import { NextResponse } from 'next/server';
import { verifyMetaSignedRequest } from '../../../../../lib/meta-signed-request';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'Threads deauthorization callback',
    accepts: 'POST signed_request from Meta',
  });
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const payload = verifyMetaSignedRequest(form.get('signed_request'));

    // Threads Scout V1.2.1 stores no OAuth token in a server-side database.
    // The browser session is an encrypted HttpOnly cookie and the provider token
    // becomes unusable after deauthorization. There is therefore no central
    // user record to delete here.
    console.info('[Threads Scout] Meta deauthorization received.', {
      userId: payload.user_id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Invalid callback.' },
      { status: error?.status || 400 }
    );
  }
}
