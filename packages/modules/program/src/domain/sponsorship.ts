import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';

/**
 * Pure rules of sponsor packages, deliverables and lead licenses (M5.4b). Unit-tested; the
 * commands apply them under row locks.
 */

/** P5-4: lead licenses every exhibitor gets unless the organizer says otherwise. */
export const DEFAULT_INCLUDED_LEAD_LICENSES = 1;
/** How long a package or license purchase holds its place while the order waits for payment. */
export const PURCHASE_HOLD_MINUTES = 15;

/** The allowances a package grants (and a grant keeps as a snapshot). */
export interface Allowances {
  readonly compRegistrations: number;
  readonly exhibitorBadges: number;
  readonly leadLicenses: number;
  readonly logoPlacements: readonly string[];
  readonly sessionSlots: number;
}

/** Exactly the package's allowances, copied (placements de-duplicated and sorted). */
export function snapshotAllowances(p: Allowances): Allowances {
  return {
    compRegistrations: p.compRegistrations,
    exhibitorBadges: p.exhibitorBadges,
    leadLicenses: p.leadLicenses,
    logoPlacements: [...new Set(p.logoPlacements)].sort(),
    sessionSlots: p.sessionSlots,
  };
}

/** A calendar date `YYYY-MM-DD` (validated, including the day of the month). */
export function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * A deliverable due on `date` is due by the end of that day in the event's time zone: the stored
 * instant is the next midnight there (exclusive). DST days are handled by `zonedTimeToUtc`.
 */
export function dueAtFromDate(date: string, timeZone: string): Date {
  if (!isCalendarDate(date)) throw new Error(`Expected YYYY-MM-DD, got ${date}`);
  return zonedTimeToUtc(`${addDays(date, 1)}T00:00`, timeZone);
}

/** The due date (`YYYY-MM-DD` in the event's zone) of a stored `due_at`. */
export function dueDateOf(dueAt: Date, timeZone: string): string {
  return utcToZonedInput(new Date(dueAt.getTime() - 1), timeZone).slice(0, 10);
}

/** A package template's due date: `daysBefore` days before the event's first day (event zone). */
export function templateDueAt(eventStartsAt: Date, daysBefore: number, timeZone: string): Date {
  const first = utcToZonedInput(eventStartsAt, timeZone).slice(0, 10);
  return dueAtFromDate(addDays(first, -daysBefore), timeZone);
}

export interface DeliverableLike {
  readonly status: string;
  readonly dueAt: Date;
}

/** Open and past its due date (the end of the due day in the event's zone). */
export function isOverdue(d: DeliverableLike, now: Date): boolean {
  return d.status === 'open' && now.getTime() >= d.dueAt.getTime();
}

/** The overdue ones, most overdue first (then by title, then id, so the list is stable). */
export function overdueDeliverables<T extends DeliverableLike & { title: string; id: string }>(
  list: readonly T[],
  now: Date,
): T[] {
  return list
    .filter((d) => isOverdue(d, now))
    .sort(
      (a, b) =>
        a.dueAt.getTime() - b.dueAt.getTime() || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
    );
}

/** Places of a package left: `null` = no limit. Held purchases count until their hold lapses. */
export function packagesLeft(
  quantity: number | null,
  grants: readonly { status: string; holdUntil: Date | null }[],
  now: Date,
): number | null {
  if (quantity === null) return null;
  const taken = grants.filter(
    (g) => g.status === 'active' || (g.status === 'pending' && g.holdUntil !== null && g.holdUntil > now),
  ).length;
  return Math.max(0, quantity - taken);
}

/** An exhibitor's staff badges: its base allowance plus every active package's exhibitor badges. */
export function staffAllowanceWithPackages(base: number, packageBadges: readonly number[]): number {
  return base + packageBadges.reduce((n, b) => n + b, 0);
}

/** P5-4: included licenses + the active packages' licenses + the paid add-on licenses. */
export function leadLicenseAllowance(input: {
  readonly included: number;
  readonly fromPackages: readonly number[];
  readonly purchased: readonly number[];
}): number {
  const sum = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0);
  return input.included + sum(input.fromPackages) + sum(input.purchased);
}

/** Seats used and left (never negative, even after the allowance shrinks). */
export function seatUse(allowance: number, assigned: number) {
  return { allowance, used: assigned, left: Math.max(0, allowance - assigned) };
}
