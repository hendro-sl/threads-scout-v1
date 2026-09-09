import { NextResponse } from 'next/server';

export async function GET(request) {
  const code = new URL(request.url).searchParams.get('code');
  if (!code) {
    return NextResponse.json(
      { status: 'invalid', message: 'Confirmation code is required.' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    status: 'complete',
    confirmation_code: code,
    message:
      'Threads Scout does not persist connected-user OAuth data in a server-side database. No stored server-side user data remains to delete.',
  });
}
