import { zonedTimeToUtc } from '@yayatoh/kernel';
import { dayIn } from '../compute.ts';
import { addDays, bucketOf } from '../dashboard.ts';
import { MAX_CATCH_UP, type ReportFrequency } from './catalog.ts';

/**
 * Report periods (M6.2b), pure. A period is a run of whole calendar days in the org's time zone:
 * one day, a Monday-to-Sunday week, or a calendar month. Its key (`D2026-10-02`, `W2026-09-28`,
 * `M2026-09`) is the dedupe key with the schedule: one run, and so one email per recipient, per
 * (schedule, period). A period is due at `send_hour` (org wall-clock time) on the day after it
 * ends. Because periods are counted in calendar days, never in hours, a daylight-saving change
 * cannot skip or repeat one: at worst the send moves by the hour the clocks moved (a send hour
 * that does not exist that night goes out at the first instant after the gap).
 */
export interface ReportPeriod {
  readonly key: string;
  /** First and last day, inclusive (`YYYY-MM-DD`). */
  readonly from: string;
  readonly to: string;
}

/** The period of a frequency that contains a calendar day. */
export function periodContaining(frequency: ReportFrequency, day: string): ReportPeriod {
  if (frequency === 'daily') return { key: `D${day}`, from: day, to: day };
  if (frequency === 'weekly') {
    const from = bucketOf(day, 'week');
    return { key: `W${from}`, from, to: addDays(from, 6) };
  }
  const from = `${day.slice(0, 7)}-01`;
  const [y, m] = from.split('-').map(Number) as [number, number];
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  return { key: `M${day.slice(0, 7)}`, from, to: addDays(next, -1) };
}

/** When a period's report is due: `sendHour`:00 org time on the day after it ends. */
export function periodDueAt(period: ReportPeriod, timeZone: string, sendHour: number): Date {
  return zonedTimeToUtc(`${addDays(period.to, 1)}T${String(sendHour).padStart(2, '0')}:00`, timeZone);
}

/**
 * The periods of a schedule that are due at `now` (oldest first): complete periods whose send
 * time has come and that became due after the schedule was created (a new schedule never sends a
 * period that was already over, nor one missed while it was switched off), at most `MAX_CATCH_UP` (periods missed while the worker was
 * down are caught up; older ones are not). Already-sent periods are filtered by the caller (the
 * run table).
 */
export function duePeriods(
  frequency: ReportFrequency,
  sendHour: number,
  timeZone: string,
  now: Date,
  activeSince: Date,
  max = MAX_CATCH_UP,
): ReportPeriod[] {
  const out: ReportPeriod[] = [];
  let p = periodContaining(frequency, dayIn(now, timeZone));
  // The current period is never complete; look back a few periods (one extra: the latest
  // complete one may not be due yet today).
  for (let i = 0; i <= max && out.length < max; i++) {
    p = periodContaining(frequency, addDays(p.from, -1));
    const due = periodDueAt(p, timeZone, sendHour);
    if (due.getTime() < activeSince.getTime()) break;
    if (due.getTime() <= now.getTime()) out.push(p);
  }
  return out.reverse();
}

/** The period of a key (validates it). */
export function periodOfKey(key: string): ReportPeriod | null {
  const m = /^(D|W|M)(\d{4}-\d{2}(?:-\d{2})?)$/.exec(key);
  if (!m) return null;
  const [, kind, rest] = m as unknown as [string, 'D' | 'W' | 'M', string];
  if (kind === 'M') return /^\d{4}-\d{2}$/.test(rest) ? periodContaining('monthly', `${rest}-01`) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rest)) return null;
  const p = periodContaining(kind === 'D' ? 'daily' : 'weekly', rest);
  return p.key === key ? p : null;
}
