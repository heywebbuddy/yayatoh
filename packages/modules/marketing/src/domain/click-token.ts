import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signed click ID (M3.8a): `yyc=<clickId>~<hmac>` in the destination URL and the `yy_click`
 * cookie. The click id is a uuidv7, so the token carries its own issue time; a token is honoured
 * only while it is younger than `maxAgeMs`. Nothing secret is stored: the HMAC (SHA-256 under
 * APP_TOKEN_SECRET, purpose-bound) proves we issued it, the click log row proves the rest.
 */

export const CLICK_PARAM = 'yyc';
export const CLICK_COOKIE = 'yy_click';
/** The click cookie bridges the redirect to the landing session; the device id covers the window. */
export const CLICK_COOKIE_MAX_AGE_S = 24 * 60 * 60;
const PURPOSE = 'tracked-click';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const mac = (id: string, secret: string) =>
  createHmac('sha256', secret).update(`${PURPOSE}:${id}`).digest('base64url').slice(0, 32);

/** Milliseconds since the epoch encoded in a uuidv7 (its first 48 bits). */
export function uuidv7Time(id: string): number {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

export function signClickId(clickId: string, secret: string): string {
  if (!UUID_V7.test(clickId)) throw new Error('click ids are uuidv7');
  return `${clickId}~${mac(clickId, secret)}`;
}

/**
 * The click id when the token is authentic and not older than `maxAgeMs` (nor from the future,
 * beyond a minute of skew); null otherwise. Constant-time compare.
 */
export function verifyClickToken(
  token: string | null | undefined,
  secret: string,
  opts: { now: number; maxAgeMs: number },
): string | null {
  if (!token || token.length > 100) return null;
  const sep = token.indexOf('~');
  if (sep <= 0) return null;
  const id = token.slice(0, sep);
  if (!UUID_V7.test(id)) return null;
  const given = Buffer.from(token.slice(sep + 1));
  const expected = Buffer.from(mac(id, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const at = uuidv7Time(id);
  if (at > opts.now + 60_000 || at < opts.now - opts.maxAgeMs) return null;
  return id;
}

/** A keyed, one-way hash for the click log (IP address or device cookie): 32 hex characters. */
export function pseudonym(kind: 'ip' | 'device', value: string, secret: string): string {
  return createHmac('sha256', secret).update(`click-${kind}:${value}`).digest('hex').slice(0, 32);
}
