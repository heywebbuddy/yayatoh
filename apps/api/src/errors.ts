import { isDomainError } from '@yayatoh/kernel';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Every error leaves `/v1` as `{ error: { code, message, details? } }`. Internals never leak. */
export function onError(err: Error, c: Context) {
  if (isDomainError(err)) return c.json({ error: err.toJSON() }, err.status as ContentfulStatusCode);
  console.error(err);
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
}

export function notFound(c: Context) {
  return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
}
