import { PROBLEM_TYPE_BASE } from '@yayatoh/contracts';
import { ERROR_STATUS, type ErrorCode, isDomainError } from '@yayatoh/kernel';

const TITLES: Record<ErrorCode, string> = {
  validation_failed: 'Validation failed',
  unauthenticated: 'Unauthenticated',
  step_up_required: 'Step-up authentication required',
  forbidden: 'Forbidden',
  impersonation_blocked: 'Not available while acting as a member',
  module_not_enabled: 'Module not enabled',
  not_found: 'Not found',
  conflict: 'Conflict',
  invalid_state: 'Invalid state',
  idempotency_key_reused: 'Idempotency key reused',
  rate_limited: 'Too many requests',
  internal: 'Internal error',
  read_only_freeze: 'Read-only maintenance',
};

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly details?: Record<string, unknown>;
}

export function problem(code: ErrorCode, detail?: string, details?: Record<string, unknown>): Problem {
  return {
    type: `${PROBLEM_TYPE_BASE}${code}`,
    title: TITLES[code],
    status: ERROR_STATUS[code],
    code,
    ...(detail ? { detail } : {}),
    ...(details ? { details } : {}),
  };
}

/** Any thrown value → problem+json body. Domain errors keep their code; internals never leak. */
export function problemFor(err: unknown): Problem {
  if (isDomainError(err)) return problem(err.code, err.message, err.details as Record<string, unknown>);
  return problem('internal');
}

/** A problem+json `Response` (for hosts that are not Hono, e.g. Next route handlers). */
export function problemResponse(p: Problem): Response {
  return new Response(JSON.stringify(p), {
    status: p.status,
    headers: {
      'content-type': 'application/problem+json',
      'cache-control': 'no-store',
      ...problemHeaders(p),
    },
  });
}

/** Extra headers a problem carries: `Retry-After` on a read-only freeze (M2.5a, roadmap §7.8). */
export function problemHeaders(p: Problem): Record<string, string> {
  if (p.code !== 'read_only_freeze') return {};
  const s = Number(p.details?.retryAfterSeconds);
  return { 'retry-after': String(Number.isFinite(s) && s > 0 ? Math.ceil(s) : 300) };
}
