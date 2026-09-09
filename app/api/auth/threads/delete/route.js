import { NextResponse } from 'next/server';
import {
  deletionConfirmationCode,
  verifyMetaSignedRequest,
} from '../../../../../lib/meta-signed-request';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'Threads data-deletion callback',
    accepts: 'POST signed_request from Meta',
    storage: 'No server-side user database is used by Threads Scout V1.2.1.',
  });
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const payload = verifyMetaSignedRequest(form.get('signed_request'));
    const confirmationCode = deletionConfirmationCode(payload.user_id);
    const statusUrl = new URL('/api/auth/threads/delete/status', request.url);
    statusUrl.searchParams.set('code', confirmationCode);

    console.info('[Threads Scout] Meta data-deletion request received.', {
      userId: payload.user_id,
      confirmationCode,
    });

    return NextResponse.json({
      url: statusUrl.toString(),
      confirmation_code: confirmationCode,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || 'Invalid callback.' },
      { status: error?.status || 400 }
    );
  }
}
