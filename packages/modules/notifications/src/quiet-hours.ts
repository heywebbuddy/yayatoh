import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';

/**
 * Quiet hours (CLAUDE.md → Time: "quiet hours use the recipient's timezone"). Non-urgent
 * messages are not sent between 21:00 and 08:00 local time (the federal TCPA window; state rules
 * such as Texas Sundays arrive with the M3.5 policy gate). Held messages go out at 08:00.
 */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** When the quiet period containing `now` ends, or null if `now` is not in quiet hours. */
export function quietHoursRelease(now: Date, timeZone: string): Date | null {
  const local = utcToZonedInput(now, timeZone); // YYYY-MM-DDTHH:mm
  const hour = Number(local.slice(11, 13));
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return null;
  let day = local.slice(0, 10);
  if (hour >= QUIET_START_HOUR) {
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return zonedTimeToUtc(`${day}T${String(QUIET_END_HOUR).padStart(2, '0')}:00`, timeZone);
}
