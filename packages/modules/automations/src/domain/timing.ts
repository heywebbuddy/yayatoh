import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import type { AnyAnchor } from './journey.ts';

/**
 * When a journey step is due (M3.7a). Pure: no I/O, Intl only.
 *
 * Days are calendar days in the event's timezone at the same wall-clock time (or at `atTime`), so
 * "7 days before a 19:00 start" is 19:00 a week earlier on the local clock, whatever DST did in
 * between (a 167- or 169-hour gap across a change, never a drift of an hour). Minutes are exact
 * durations added after that. A wall time that doesn't exist that day (spring forward) moves past
 * the gap; an ambiguous one (fall back) takes the earlier instant.
 */

export interface StepWait {
  readonly anchor: AnyAnchor;
  readonly offsetDays: number;
  readonly offsetMinutes: number;
  readonly atTime: string | null;
}

export interface Anchors {
  /** When the person was enrolled (the purchase, the check-in). */
  readonly trigger: Date;
  readonly eventStart: Date;
  readonly eventEnd: Date;
  /** The event's IANA zone. */
  readonly timeZone: string;
  /** M4.1f: the event's RSVP deadline (`rsvp_deadline` steps), when it has one. */
  readonly rsvpDeadline?: Date | null;
  /** M5.1d: an invoice run's due moment (start of the due day, event timezone). */
  readonly invoiceDue?: Date | null;
}

const DAY_MS = 86_400_000;

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The anchor's instant (an `rsvp_deadline` step of an event without a deadline: the event's start). */
export function anchorTime(anchor: AnyAnchor, anchors: Anchors): Date {
  return anchor === 'trigger'
    ? anchors.trigger
    : anchor === 'event_start'
      ? anchors.eventStart
      : anchor === 'rsvp_deadline'
        ? (anchors.rsvpDeadline ?? anchors.eventStart)
        : anchor === 'invoice_due'
          ? (anchors.invoiceDue ?? anchors.trigger)
          : anchors.eventEnd;
}

/** The instant a step with this wait is due. */
export function stepDueAt(wait: StepWait, anchors: Anchors): Date {
  const base = anchorTime(wait.anchor, anchors);
  let at = base;
  if (wait.offsetDays !== 0 || wait.atTime) {
    const tz = validZone(anchors.timeZone) ? anchors.timeZone : 'UTC';
    const local = utcToZonedInput(base, tz);
    const day = new Date(Date.parse(`${local.slice(0, 10)}T00:00:00Z`) + wait.offsetDays * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const time = wait.atTime ?? local.slice(11, 16);
    // Keep the anchor's seconds when keeping its wall-clock time (like reminders, M1.10d).
    const seconds = wait.atTime ? 0 : base.getTime() % 60_000;
    at = new Date(zonedTimeToUtc(`${day}T${time}`, tz).getTime() + seconds);
  }
  return new Date(at.getTime() + wait.offsetMinutes * 60_000);
}

export type StepPlan = { readonly dueAt: Date } | { readonly skip: 'too_late' | 'no_deadline' };

/**
 * Where a step goes. On enrollment a step whose time has passed is skipped (`too_late`: someone
 * who buys three days out gets no "one week to go"), except steps that wait from the trigger itself,
 * which run now. On a reschedule (the event moved) a pending step moves to its new time; if that
 * has passed it runs now while its anchor is still ahead (or it waits for after the anchor), and is
 * skipped once the moment it was meant to precede is over. Grace: a minute, so "now" is not late.
 */
export function planStep(
  wait: StepWait,
  anchors: Anchors,
  now: Date,
  mode: 'enroll' | 'reschedule',
): StepPlan {
  // An RSVP reminder needs a deadline to count back from (M4.1f).
  if (wait.anchor === 'rsvp_deadline' && !anchors.rsvpDeadline) return { skip: 'no_deadline' };
  const due = stepDueAt(wait, anchors);
  if (due.getTime() >= now.getTime() - 60_000) return { dueAt: due };
  if (wait.anchor === 'trigger') return { dueAt: now };
  if (mode === 'enroll') return { skip: 'too_late' };
  const before =
    wait.offsetDays < 0 ||
    wait.offsetMinutes < 0 ||
    (wait.atTime !== null && due < anchorTime(wait.anchor, anchors));
  if (before && anchorTime(wait.anchor, anchors).getTime() <= now.getTime()) return { skip: 'too_late' };
  return { dueAt: now };
}

/** How long the runner waits before trying a failed step again (attempt 1 → 1 min … → 1 h). */
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
/** Attempts before a step is marked failed (and the failure alert is raised). */
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

export function retryAt(attempts: number, now: Date): Date {
  const i = Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1);
  return new Date(now.getTime() + (RETRY_BACKOFF_MS[i] as number));
}
