import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Link tokens are `<rowId>~<hmac>`: HMAC-SHA256 of purpose + id under APP_TOKEN_SECRET. Nothing
 * secret is stored; the row's state (claimed, revoked, expired) decides whether it still works.
 * `~` keeps the path free of dots, which the locale proxy treats as static files.
 */
function mac(purpose: string, id: string, secret: string): string {
  return createHmac('sha256', secret).update(`${purpose}:${id}`).digest('base64url');
}

export function signLinkToken(purpose: string, id: string, secret = appTokenSecret()): string {
  return `${id}~${mac(purpose, id, secret)}`;
}

/** The row id if the token is authentic for this purpose, else null (constant-time compare). */
export function verifyLinkToken(purpose: string, token: string, secret = appTokenSecret()): string | null {
  const sep = token.indexOf('~');
  if (sep <= 0) return null;
  const id = token.slice(0, sep);
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const given = Buffer.from(token.slice(sep + 1));
  const expected = Buffer.from(mac(purpose, id, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function appTokenSecret(): string {
  const s = process.env.APP_TOKEN_SECRET;
  if (!s || s.length < 32) throw new Error('APP_TOKEN_SECRET (≥32 chars) is not set (see .env.example)');
  return s;
}
