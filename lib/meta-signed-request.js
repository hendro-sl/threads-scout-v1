import crypto from 'crypto';

function base64urlToBuffer(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export function verifyMetaSignedRequest(signedRequest) {
  const appSecret = process.env.THREADS_APP_SECRET;
  if (!appSecret) throw new Error('THREADS_APP_SECRET is not configured.');
  if (!signedRequest || typeof signedRequest !== 'string') {
    const error = new Error('signed_request is required.');
    error.status = 400;
    throw error;
  }

  const parts = signedRequest.split('.');
  if (parts.length !== 2) {
    const error = new Error('Invalid signed_request format.');
    error.status = 400;
    throw error;
  }

  const [signatureSegment, payloadSegment] = parts;
  const signature = base64urlToBuffer(signatureSegment);
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(payloadSegment)
    .digest();

  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
    const error = new Error('Invalid signed_request signature.');
    error.status = 401;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlToBuffer(payloadSegment).toString('utf8'));
  } catch {
    const error = new Error('Invalid signed_request payload.');
    error.status = 400;
    throw error;
  }

  if (payload?.algorithm && payload.algorithm !== 'HMAC-SHA256') {
    const error = new Error('Unsupported signed_request algorithm.');
    error.status = 400;
    throw error;
  }

  if (!payload?.user_id) {
    const error = new Error('signed_request does not contain a user_id.');
    error.status = 400;
    throw error;
  }

  return payload;
}

export function deletionConfirmationCode(userId) {
  const appSecret = process.env.THREADS_APP_SECRET || '';
  return crypto
    .createHash('sha256')
    .update(`threads-scout:${userId}:${appSecret}`)
    .digest('hex')
    .slice(0, 32);
}
