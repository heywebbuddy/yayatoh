import { type Problem, problem, problemFor, problemHeaders } from '@yayatoh/platform/http';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export { problem };

function send(c: Context, body: Problem) {
  return c.body(JSON.stringify(body), body.status as ContentfulStatusCode, {
    'content-type': 'application/problem+json',
    ...problemHeaders(body),
  });
}

/** Every error leaves `/v1` as RFC 9457 problem+json. Internals never leak. */
export function onError(err: Error, c: Context) {
  const p = problemFor(err);
  if (p.code === 'internal') console.error(err);
  return send(c, p);
}

export function notFound(c: Context) {
  return send(c, problem('not_found'));
}

export function validationFailed(c: Context) {
  return send(c, problem('validation_failed', 'Invalid request'));
}
