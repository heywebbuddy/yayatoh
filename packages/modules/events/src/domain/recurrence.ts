import { DomainError, utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';

/**
 * Recurring dates (M1.4b): a small RFC 5545 subset — FREQ=DAILY|WEEKLY|MONTHLY with INTERVAL,
 * BYDAY (weekly), BYMONTHDAY (monthly) and UNTIL or COUNT. Rules are expanded in the event's
 * wall-clock time, so a 7 pm weekly event stays 7 pm local across DST changes; each instance is
 * converted to an instant with `zonedTimeToUtc` (gap → moves forward, overlap → earlier instant).
 * The rule is expanded when dates are added; only the resulting occurrences are stored.
 */
export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

/** At most this many dates per event (a daily event for a year, leap years included). */
export const MAX_OCCURRENCES = 366;
/** Rules may not reach further than this many years past their first day. */
export const MAX_RULE_YEARS = 5;

export interface RecurrenceRule {
  /** First local day the rule may produce, `YYYY-MM-DD`. */
  readonly startDate: string;
  /** Local wall-clock start and end, `HH:mm`. An end at or before the start ends the next day. */
  readonly startTime: string;
  readonly endTime: string;
  readonly freq: RecurrenceFreq;
  /** Every n days / weeks / months (1–52). */
  readonly interval: number;
  /** Weekly: ISO weekdays, 1 = Monday … 7 = Sunday. Empty = the start day's weekday. */
  readonly byWeekday?: readonly number[];
  /** Monthly: day of the month (1–31). Months without that day are skipped (RFC 5545). */
  readonly byMonthDay?: number | null;
  /** Exactly one of `until` (last local day, inclusive) or `count`. */
  readonly until?: string | null;
  readonly count?: number | null;
}

export interface ExpandedDate {
  /** The local calendar day of the start, `YYYY-MM-DD`. */
  readonly localDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export type RecurrenceProblem =
  | 'invalid_date'
  | 'invalid_time'
  | 'invalid_interval'
  | 'invalid_weekday'
  | 'invalid_month_day'
  | 'no_end'
  | 'both_ends'
  | 'until_before_start'
  | 'too_far'
  | 'too_many'
  | 'no_dates';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

const fail = (reason: RecurrenceProblem, field: string, message: string): never => {
  throw new DomainError('validation_failed', message, { reason, field });
};

/** A civil date (no zone) as a UTC-midnight Date, or null if it does not exist. */
function civil(s: string): Date | null {
  const m = DATE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    ? date
    : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
/** ISO weekday of a civil date: 1 = Monday … 7 = Sunday. */
const isoWeekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/**
 * Expand a rule into dates, in order. Throws `validation_failed` with a `reason` (and the form
 * `field`) for an invalid rule, a rule without an end, or one producing more than `max` dates.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  timeZone: string,
  max: number = MAX_OCCURRENCES,
): ExpandedDate[] {
  const start = civil(rule.startDate) ?? fail('invalid_date', 'startDate', 'Enter a valid first date');
  if (!TIME.test(rule.startTime)) fail('invalid_time', 'startTime', 'Enter a start time as HH:mm');
  if (!TIME.test(rule.endTime)) fail('invalid_time', 'endTime', 'Enter an end time as HH:mm');
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 52)
    fail('invalid_interval', 'interval', 'Repeat every 1 to 52');
  const hasUntil = rule.until != null && rule.until !== '';
  const hasCount = rule.count != null;
  if (!hasUntil && !hasCount) fail('no_end', 'until', 'Choose an end date or a number of dates');
  if (hasUntil && hasCount) fail('both_ends', 'until', 'Choose an end date or a number of dates, not both');
  let until: Date | null = null;
  if (hasUntil) {
    until = civil(rule.until as string) ?? fail('invalid_date', 'until', 'Enter a valid end date');
    if (until < start) fail('until_before_start', 'until', 'The end date is before the first date');
  }
  const count = rule.count ?? null;
  if (count !== null && (!Number.isInteger(count) || count < 1))
    fail('invalid_interval', 'count', 'Enter a number of dates of at least 1');
  if (count !== null && count > max) fail('too_many', 'count', `At most ${max} dates`);
  const horizon = new Date(
    Date.UTC(start.getUTCFullYear() + MAX_RULE_YEARS, start.getUTCMonth(), start.getUTCDate()),
  );
  if (until && until > horizon) fail('too_far', 'until', `Rules can reach ${MAX_RULE_YEARS} years ahead`);
  const last = until ?? horizon;

  const days: Date[] = [];
  // Collects one candidate day; returns false once the rule is exhausted.
  const push = (d: Date): boolean => {
    if (d > last) return false;
    if (d < start) return true;
    days.push(d);
    if (days.length > max) fail('too_many', hasUntil ? 'until' : 'count', `At most ${max} dates`);
    return count === null || days.length < count;
  };

  if (rule.freq === 'daily') {
    for (let d = start; push(d); d = addDays(d, rule.interval));
  } else if (rule.freq === 'weekly') {
    const weekdays = [...new Set(rule.byWeekday?.length ? rule.byWeekday : [isoWeekday(start)])].sort();
    if (weekdays.some((w) => !Number.isInteger(w) || w < 1 || w > 7))
      fail('invalid_weekday', 'byWeekday', 'Choose weekdays');
    const monday = addDays(start, 1 - isoWeekday(start));
    outer: for (let week = monday; week <= last; week = addDays(week, 7 * rule.interval)) {
      for (const w of weekdays) if (!push(addDays(week, w - 1))) break outer;
    }
  } else {
    const day = rule.byMonthDay ?? start.getUTCDate();
    if (!Number.isInteger(day) || day < 1 || day > 31)
      fail('invalid_month_day', 'byMonthDay', 'Choose a day of the month');
    for (let k = 0; ; k += rule.interval) {
      const y = start.getUTCFullYear() + Math.floor((start.getUTCMonth() + k) / 12);
      const m0 = (start.getUTCMonth() + k) % 12;
      if (new Date(Date.UTC(y, m0, 1)) > last) break;
      // The 31st only happens in months that have one.
      if (day > daysInMonth(y, m0)) continue;
      if (!push(new Date(Date.UTC(y, m0, day)))) break;
    }
  }
  if (days.length === 0) fail('no_dates', 'startDate', 'This rule produces no dates');

  const overnight = rule.endTime <= rule.startTime;
  return days.map((d) => {
    const localDate = iso(d);
    const endDate = overnight ? iso(addDays(d, 1)) : localDate;
    return {
      localDate,
      startsAt: zonedTimeToUtc(`${localDate}T${rule.startTime}`, timeZone),
      endsAt: zonedTimeToUtc(`${endDate}T${rule.endTime}`, timeZone),
    };
  });
}

/**
 * "This and following": move an occurrence to a new wall-clock start/end time of day while
 * keeping its local date (and the same overnight rule), so a DST change never shifts it.
 */
export function retimeLocal(
  startsAt: Date,
  timeZone: string,
  startTime: string,
  endTime: string,
): { startsAt: Date; endsAt: Date } {
  if (!TIME.test(startTime)) fail('invalid_time', 'startTime', 'Enter a start time as HH:mm');
  if (!TIME.test(endTime)) fail('invalid_time', 'endTime', 'Enter an end time as HH:mm');
  const localDate = utcToZonedInput(startsAt, timeZone).slice(0, 10);
  const endDate = endTime <= startTime ? iso(addDays(civil(localDate) as Date, 1)) : localDate;
  return {
    startsAt: zonedTimeToUtc(`${localDate}T${startTime}`, timeZone),
    endsAt: zonedTimeToUtc(`${endDate}T${endTime}`, timeZone),
  };
}
