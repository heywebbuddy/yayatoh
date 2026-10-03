import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';

/**
 * When the Slack daily digest goes out (M6.4c): at a wall-clock time in the org's time zone. Pure.
 * DST: a time that does not exist that day (spring forward) moves forward by the gap; a time that
 * happens twice (fall back) is the earlier one. Either way the digest's dedupe key is the local
 * day, so a day never gets two digests and never gets none.
 */

export const DIGEST_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** `YYYY-MM-DD` plus `days`, as a calendar day. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The local calendar day of an instant in `timeZone`. */
export const localDay = (at: Date, timeZone: string) => utcToZonedInput(at, timeZone).slice(0, 10);

/** The first instant strictly after `after` whose local time in `timeZone` is `time` (`HH:MM`). */
export function nextDigestAt(after: Date, time: string, timeZone: string): Date {
  if (!DIGEST_TIME.test(time)) throw new Error(`Expected HH:MM, got ${time}`);
  const day = localDay(after, timeZone);
  for (let i = 0; i < 3; i++) {
    const at = zonedTimeToUtc(`${addDays(day, i)}T${time}`, timeZone);
    if (at > after) return at;
  }
  throw new Error('unreachable');
}

/** The instants a local day spans in `timeZone`: [start, next day's start). */
export function dayBounds(day: string, timeZone: string): { from: Date; to: Date } {
  return {
    from: zonedTimeToUtc(`${day}T00:00`, timeZone),
    to: zonedTimeToUtc(`${addDays(day, 1)}T00:00`, timeZone),
  };
}
