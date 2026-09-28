import { createHash } from 'node:crypto';
import type { Context } from 'hono';

/** Anonymous reads: shared caches and apps may keep them a minute (the existing public routes' policy). */
export const PUBLIC_CACHE = 'public, max-age=60';
/** Org reads: only the caller may keep them, and must revalidate (cheap with the ETag). */
export const PRIVATE_CACHE = 'private, no-cache';

/** A strong ETag over the exact JSON body. */
export function etagOf(body: string): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;
}

function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;
  // Weak comparison (RFC 9110 §13.1.2): `W/"x"` matches `"x"`.
  return ifNoneMatch.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
}

/**
 * A 200 JSON response with `ETag` and `Cache-Control`; `If-None-Match` with the same tag gets a
 * bodiless 304 carrying the same validators. The body is already an allowlisted wire object.
 */
export function cachedJson<T>(c: Context, body: T, cacheControl: string) {
  const text = JSON.stringify(body);
  const etag = etagOf(text);
  c.header('etag', etag);
  c.header('cache-control', cacheControl);
  if (matches(c.req.header('if-none-match'), etag)) return c.body(null, 304);
  return c.body(text, 200, { 'content-type': 'application/json' });
}
