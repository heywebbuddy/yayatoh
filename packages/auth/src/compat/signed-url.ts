import { createHmac, timingSafeEqual } from 'node:crypto';

/** RFC 3986 encoding as PHP's `http_build_query(..., PHP_QUERY_RFC3986)` produces it. */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Verify a Laravel signed URL (`URL::signedRoute` / `temporarySignedRoute`):
 * `signature = hmac_sha256(url-without-signature, APP_KEY)`, with `expires` (Unix seconds)
 * enforced when present. Legacy verification and download links keep working after cutover.
 */
export function verifyLaravelSignedUrl(url: string, key: Buffer, now: Date = new Date()): boolean {
  const u = new URL(url);
  const signature = u.searchParams.get('signature');
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const params = [...u.searchParams.entries()].filter(([k]) => k !== 'signature');
  const query = params.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join('&');
  const original = `${u.origin}${u.pathname}${query ? `?${query}` : ''}`;
  const expected = createHmac('sha256', key).update(original).digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const expires = u.searchParams.get('expires');
  return expires === null || Number(expires) * 1000 > now.getTime();
}
