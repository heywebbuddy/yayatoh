/** What went wrong with a call, in the few kinds a screen tells apart (M7.3c). */
import { YayatohApiError } from '@yayatoh/sdk';

export type FailureKind =
  /** No connection, a timeout, or the server unreachable. */
  | 'network'
  | 'rate_limited'
  | 'not_found'
  | 'unauthenticated'
  | 'unverified_email'
  | 'risk_blocked'
  | 'org_suspended'
  | 'hold_expired'
  | 'buy_on_web'
  | 'idempotency_reused'
  | 'promo_invalid'
  | 'sold_out'
  | 'invalid'
  | 'unknown';

export interface Failure {
  readonly kind: FailureKind;
  /** Seconds to wait, from `Retry-After`, for `rate_limited`. */
  readonly retryAfter: number | null;
  /** `details` of the problem: `webUrl` and `ticketTypeIds` for `buy_on_web`. */
  readonly details: Readonly<Record<string, unknown>>;
}

const REASONS: Readonly<Record<string, FailureKind>> = {
  buy_on_web: 'buy_on_web',
  hold_expired: 'hold_expired',
  risk_blocked: 'risk_blocked',
  org_suspended: 'org_suspended',
  org_terminated: 'org_suspended',
  sold_out: 'sold_out',
  promo_invalid: 'promo_invalid',
  coupon_buyer_limit: 'promo_invalid',
  email_unverified: 'unverified_email',
};

const CODES: Readonly<Record<string, FailureKind>> = {
  rate_limited: 'rate_limited',
  not_found: 'not_found',
  unauthenticated: 'unauthenticated',
  idempotency_key_reused: 'idempotency_reused',
  validation_failed: 'invalid',
};

/** The kind of failure a call ended in; the reason inside the problem is more specific than its code. */
export function failureOf(error: unknown): Failure {
  if (!(error instanceof YayatohApiError)) {
    // `fetch` rejects with a TypeError when there is no network.
    return { kind: error instanceof TypeError ? 'network' : 'unknown', retryAfter: null, details: {} };
  }
  const details = (error.problem?.details ?? {}) as Record<string, unknown>;
  const reason = typeof details.reason === 'string' ? details.reason : '';
  const kind = REASONS[reason] ?? CODES[error.code] ?? 'unknown';
  return { kind, retryAfter: error.retryAfter, details };
}
