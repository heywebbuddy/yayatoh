/**
 * When the worker checks a pending custom domain again (M1.3f), without anyone pressing "Check
 * now". DNS changes land within minutes to a day, so checks start often and back off with the
 * domain's age; after a week the worker stops (the organizer can still check by hand).
 */
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Domains older than this are no longer checked automatically. */
export const RECHECK_MAX_AGE_MS = 7 * 24 * HOUR;

/** The wait between automatic checks for a domain added `ageMs` ago. */
export function recheckIntervalMs(ageMs: number): number {
  if (ageMs < 10 * MIN) return MIN;
  if (ageMs < HOUR) return 5 * MIN;
  if (ageMs < 6 * HOUR) return 15 * MIN;
  if (ageMs < 24 * HOUR) return 30 * MIN;
  return HOUR;
}

/** Whether a pending domain is due for an automatic check at `now`. */
export function recheckDue(d: { createdAt: Date; lastCheckedAt: Date | null }, now: Date): boolean {
  const age = now.getTime() - d.createdAt.getTime();
  if (age < 0 || age > RECHECK_MAX_AGE_MS) return false;
  if (!d.lastCheckedAt) return true;
  return now.getTime() - d.lastCheckedAt.getTime() >= recheckIntervalMs(age);
}

/**
 * The job's own backoff after the provider failed (errors, timeouts, 429s): 1, 2, 4 … minutes,
 * at most 30, reset by the next clean run.
 */
export function providerBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(30 * MIN, MIN * 2 ** (consecutiveFailures - 1));
}
