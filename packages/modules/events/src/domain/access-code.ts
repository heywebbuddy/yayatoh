/** Access codes are matched case-insensitively: stored and compared upper-case, spaces ignored. */
export const normalizeAccessCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();

export const ACCESS_CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/;

/** Failed attempts allowed per client key per event in the window, then `rate_limited`. */
export const ACCESS_ATTEMPTS_PER_WINDOW = 10;
export const ACCESS_ATTEMPT_WINDOW_MS = 15 * 60_000;

export interface AccessCodeState {
  readonly active: boolean;
  readonly expiresAt: Date | null;
  readonly maxUses: number | null;
  readonly uses: number;
}

export type AccessCodeProblem = 'inactive' | 'expired' | 'used_up';

/**
 * Whether a code can unlock now. `forRedeem` counts the use limit (a new unlock); a visitor who
 * already unlocked keeps access after the limit is reached, until expiry or deactivation.
 */
export function accessCodeProblem(
  c: AccessCodeState,
  now: Date,
  forRedeem: boolean,
): AccessCodeProblem | null {
  if (!c.active) return 'inactive';
  if (c.expiresAt && c.expiresAt <= now) return 'expired';
  if (forRedeem && c.maxUses !== null && c.uses >= c.maxUses) return 'used_up';
  return null;
}
