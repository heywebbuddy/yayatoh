/**
 * M5.9a conference pack (pure): how the session tiles grade a session. The alert engine's rules
 * use the same numbers (`alert-thresholds.test.ts` keeps them equal).
 */

/** A session is nearly full at 95 % of its places. */
export const SESSION_NEAR_PCT = 95;
/** A waiting line is long above 10 people. */
export const WAITLIST_MAX = 10;

/** A kiosk counts as in use for the event when seen within 12 hours (the alert engine's device window). */
export const KIOSK_IN_USE_MS = 12 * 3_600_000;

export type SessionLevel = 'none' | 'ok' | 'near' | 'over';

/** A session's level: no limit, below the line, nearly full, or at/over its places. */
export function sessionLevel(n: number, capacity: number | null): SessionLevel {
  if (capacity === null || capacity <= 0) return 'none';
  if (n >= capacity) return 'over';
  if (n * 100 >= SESSION_NEAR_PCT * capacity) return 'near';
  return 'ok';
}

/** Fill in whole per cent (0 without a limit), for ordering and meters. */
export const fillPct = (n: number, capacity: number | null): number =>
  capacity && capacity > 0 ? Math.floor((n * 100) / capacity) : 0;
