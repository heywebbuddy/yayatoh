import { PROBLEM_TYPE_BASE, type ProblemDto } from '@yayatoh/contracts';
import { ERROR_STATUS, type ErrorCode, isDomainError } from '@yayatoh/kernel';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const TITLES: Record<ErrorCode, string> = {
  validation_failed: 'Validation failed',
  unauthenticated: 'Unauthenticated',
  step_up_required: 'Step-up authentication required',
  forbidden: 'Forbidden',
  module_not_enabled: 'Module not enabled',
  not_found: 'Not found',
  conflict: 'Conflict',
  invalid_state: 'Invalid state',
  idempotency_key_reused: 'Idempotency key reused',
  rate_limited: 'Too many requests',
  internal: 'Internal error',
};

export function problem(code: ErrorCode, detail?: string, details?: Record<string, unknown>): ProblemDto {
  return {
    type: `${PROBLEM_TYPE_BASE}${code}`,
    title: TITLES[code],
    status: ERROR_STATUS[code],
    code,
    ...(detail ? { detail } : {}),
    ...(details ? { details } : {}),
  };
}

function send(c: Context, body: ProblemDto) {
  return c.body(JSON.stringify(body), body.status as ContentfulStatusCode, {
    'content-type': 'application/problem+json',
  });
}

/** Every error leaves `/v1` as RFC 9457 problem+json. Internals never leak. */
export function onError(err: Error, c: Context) {
  if (isDomainError(err))
    return send(c, problem(err.code, err.message, err.details as Record<string, unknown>));
  console.error(err);
  return send(c, problem('internal'));
}

export function notFound(c: Context) {
  return send(c, problem('not_found'));
}

export function validationFailed(c: Context) {
  return send(c, problem('validation_failed', 'Invalid request'));
}
