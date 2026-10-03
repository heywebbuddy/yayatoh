/**
 * Stable error codes shared by every transport. `/v1` maps them to HTTP status codes;
 * Server Actions return them to the UI. Never put user data or SQL in `message`.
 */
export const ERROR_STATUS = {
  validation_failed: 400,
  unauthenticated: 401,
  step_up_required: 401,
  forbidden: 403,
  /** Refused while platform staff act as a member (money, exports, deletions, step-up; M1.2e). */
  impersonation_blocked: 403,
  module_not_enabled: 403,
  not_found: 404,
  conflict: 409,
  invalid_state: 409,
  idempotency_key_reused: 422,
  rate_limited: 429,
  internal: 500,
  /**
   * The platform (or this org) is in read-only freeze during a cutover or rollback (M2.5a): every
   * write is refused until it ends; reads, offline check-in scans and public pages keep working.
   */
  read_only_freeze: 503,
  /**
   * The org is read-only after a failed subscription renewal (M6.6b dunning): its members' and API
   * keys' writes are refused until it pays; reads, exports and the door keep working, nothing is
   * deleted.
   */
  read_only_billing: 402,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return this.details
      ? { code: this.code, message: this.message, details: { ...this.details } }
      : { code: this.code, message: this.message };
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
