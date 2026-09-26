import crypto from 'node:crypto';

const hmac = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest();

export function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body, secret).toString('base64url')}`;
}

export function verify(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = hmac(body, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp < now) return null;
  return payload;
}
