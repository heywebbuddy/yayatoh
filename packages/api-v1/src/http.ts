import { type Problem, problem, problemFor } from '@yayatoh/platform/http';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export { problem };

export function sendProblem(c: Context, body: Problem, headers: Record<string, string> = {}) {
  return c.body(JSON.stringify(body), body.status as ContentfulStatusCode, {
    'content-type': 'application/problem+json',
    'cache-control': 'no-store',
    ...headers,
  });
}

/** Every /v1 error leaves as RFC 9457 problem+json with a stable `code`. Internals never leak. */
export function onV1Error(err: Error, c: Context) {
  const p = problemFor(err);
  if (p.code === 'internal') console.error(err);
  const retry = p.code === 'rate_limited' ? (p.details?.retryAfter as number | undefined) : undefined;
  return sendProblem(c, p, retry ? { 'retry-after': String(retry) } : {});
}
