import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import { isValidTimeZone } from './quiet-hours.ts';

/**
 * When an event reminder goes out (M1.10a, DST-safe since M1.10d): the day before the start at the
 * same wall-clock time in the event's timezone. Across a DST change that is 23 or 25 hours before,
 * not a fixed 24: a 19:00 show gets its reminder at 19:00 the evening before. A wall time that
 * doesn't exist that day (spring forward) moves forward past the gap; an ambiguous one (fall back)
 * takes the earlier instant. Pure: no I/O, Intl only.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The reminder instant for an event starting at `startsAt` in `timeZone`. */
export function reminderTime(startsAt: Date, timeZone: string | null | undefined): Date {
  if (!isValidTimeZone(timeZone)) return new Date(startsAt.getTime() - DAY_MS);
  const local = utcToZonedInput(startsAt, timeZone);
  const dayBefore = new Date(Date.parse(`${local.slice(0, 10)}T00:00:00Z`) - DAY_MS)
    .toISOString()
    .slice(0, 10);
  const seconds = startsAt.getTime() % 60_000;
  return new Date(zonedTimeToUtc(`${dayBefore}${local.slice(10)}`, timeZone).getTime() + seconds);
}

export type ReminderPlan =
  | { readonly sendAfter: Date }
  | { readonly cancel: 'event_started' | 'event_cancelled' | 'event_postponed' };

/**
 * Where a queued reminder goes after its event (or date) moved: the new reminder time, or now when
 * that has passed but the event is still ahead (people learn the new time at once), or cancelled
 * when the event has started or was cancelled. A postponed event's reminder is parked
 * (`event_postponed`) until the event is rescheduled.
 */
export function planReminder(
  target: {
    readonly startsAt: Date;
    readonly timeZone: string | null;
    readonly cancelled?: boolean;
    readonly postponed?: boolean;
  },
  now: Date,
): ReminderPlan {
  if (target.cancelled) return { cancel: 'event_cancelled' };
  if (target.postponed) return { cancel: 'event_postponed' };
  if (target.startsAt.getTime() <= now.getTime()) return { cancel: 'event_started' };
  const at = reminderTime(target.startsAt, target.timeZone);
  return { sendAfter: at.getTime() > now.getTime() ? at : now };
}
