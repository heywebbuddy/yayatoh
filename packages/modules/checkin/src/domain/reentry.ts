/** The re-entry window an organizer can set: from one hour to three days. */
export const REENTRY_MIN_HOURS = 1;
export const REENTRY_MAX_HOURS = 72;

export const validReentryHours = (hours: number) =>
  Number.isInteger(hours) && hours >= REENTRY_MIN_HOURS && hours <= REENTRY_MAX_HOURS;

/** When the ticket last came in: its latest re-entry, else its first admission. */
export const lastEntryOf = (admission: { admittedAt: Date; lastEntryAt: Date | null }): Date =>
  admission.lastEntryAt ?? admission.admittedAt;

/**
 * May a ticket that came in at `lastEntry` be scanned in again at `now`? Only once `hours` full
 * hours have passed (exactly at the boundary counts). Without a window (`null`) never: a second
 * scan the same day stays a duplicate.
 */
export function reentryDue(lastEntry: Date, now: Date, hours: number | null): boolean {
  if (hours === null || !validReentryHours(hours)) return false;
  return now.getTime() - lastEntry.getTime() >= hours * 3_600_000;
}
