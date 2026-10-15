/** Retry delays for the outbox: 2 s, 4 s, 8 s … capped at 5 minutes, spread ±20 % so doors do not sync in step. */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 300_000;

/** `failures` is the number of failed attempts in a row (1 after the first failure). `unit` is 0..1. */
export function backoffMs(failures: number, unit = 0.5): number {
  if (failures <= 0) return 0;
  const raw = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
  const jitter = 0.8 + 0.4 * Math.min(1, Math.max(0, unit));
  return Math.round(raw * jitter);
}
