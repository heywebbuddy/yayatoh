/**
 * Watch time (M6.9a). The player sends a heartbeat about every 30 seconds while it plays; each
 * heartbeat carries its viewing's playback token and a sequence number that only goes up. The
 * server counts **the minute it received the heartbeat in** (its own clock, never the client's),
 * at most once per attendee per session per minute. A heartbeat whose sequence is not above the
 * last one accepted (a duplicate, a retry, a replayed request) counts nothing.
 */
export const MINUTE_MS = 60_000;
/** How long a playback token lives; the player asks for a fresh one before it ends. */
export const PLAYBACK_TTL_MS = 10 * MINUTE_MS;
/** The player renews its token when less than this is left. */
export const RENEW_BEFORE_MS = 2 * MINUTE_MS;
/** How often the player sends a heartbeat (twice a minute, so no minute is missed). */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Largest heartbeat sequence (a viewing lasts one token, ~20 beats; this is generous). */
export const MAX_SEQ = 1_000_000;

/** The start of the minute `at` falls in (UTC; minutes are the same in every time zone). */
export function minuteOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);
}

export type BeatVerdict = 'count' | 'replayed' | 'expired';

/**
 * Whether a heartbeat may count: the viewing must not have expired, and its sequence must be
 * above the last one accepted.
 */
export function beatVerdict(view: { beatSeq: number; expiresAt: Date }, seq: number, now: Date): BeatVerdict {
  if (view.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (seq <= view.beatSeq) return 'replayed';
  return 'count';
}

/** Minutes as "1 h 05 min"-style parts for the console (whole minutes only). */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const t = Math.max(0, Math.floor(total));
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}
