import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';

/**
 * Event modes (roadmap M3.2): the Command Center changes its layout and widgets as an event moves
 * from planning to the show and after it. Pure, universal (the browser shows the same boundaries).
 *
 * - `planning` until the pre-show starts;
 * - `pre_show` from T−1 day (the same wall-clock time the day before the start, in the event's
 *   IANA time zone) until doors −2 h;
 * - `live` from doors −2 h until the end +2 h (absolute hours);
 * - `wrap` from then until the end +7 days (wall-clock days in the event's time zone), after which
 *   the event stays in `wrap` with no further change (`settled`).
 *
 * Day offsets are calendar days in the event's zone, so across a DST change the pre-show starts
 * 23 or 25 real hours before the doors; hour offsets are real hours. Doors default to the start
 * (events have no separate doors time yet). A multi-date event uses its current date: the one that
 * is live, else the next one within its pre-show, else the last one that ended (wrap, until the
 * next date's pre-show), else the next one (planning).
 */
export const EVENT_MODES = ['planning', 'pre_show', 'live', 'wrap'] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const PRE_SHOW_DAYS = 1;
export const LIVE_BEFORE_DOORS_MS = 2 * 3_600_000;
export const LIVE_AFTER_END_MS = 2 * 3_600_000;
export const WRAP_DAYS = 7;

export function isEventMode(v: unknown): v is EventMode {
  return typeof v === 'string' && (EVENT_MODES as readonly string[]).includes(v);
}

/** The same wall-clock time `days` calendar days later (or earlier) in `timeZone`. */
export function addZonedDays(instant: Date, days: number, timeZone: string): Date {
  const local = utcToZonedInput(instant, timeZone);
  const [date, time] = local.split('T') as [string, string];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  // Seconds and milliseconds are not part of the wall-clock minute: carry them over.
  const rest = instant.getTime() - zonedTimeToUtc(local, timeZone).getTime();
  return new Date(zonedTimeToUtc(`${shifted}T${time}`, timeZone).getTime() + rest);
}

export interface ModeDate {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: 'scheduled' | 'cancelled';
}

export interface ModeInput {
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Doors open (defaults to the start). */
  readonly doorsAt?: Date | null;
  readonly timeZone: string;
  /** The event's dates (empty for a single-date event). */
  readonly occurrences: readonly ModeDate[];
  readonly now: Date;
}

/** One date's mode boundaries. */
export interface ModeWindow {
  readonly occurrenceId: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly preShowAt: Date;
  readonly liveAt: Date;
  readonly liveEndsAt: Date;
  readonly wrapEndsAt: Date;
}

export interface ModeResult {
  readonly mode: EventMode;
  /** The date the mode is about (null for a single-date event). */
  readonly window: ModeWindow;
  /** When the computed mode next changes, and to what (null once settled). */
  readonly nextChangeAt: Date | null;
  readonly nextMode: EventMode | null;
  /** The last date's wrap is over: nothing changes any more. */
  readonly settled: boolean;
}

export function modeWindow(
  date: { id: string | null; startsAt: Date; endsAt: Date; doorsAt?: Date | null },
  timeZone: string,
): ModeWindow {
  const doors = date.doorsAt ?? date.startsAt;
  return {
    occurrenceId: date.id,
    startsAt: date.startsAt,
    endsAt: date.endsAt,
    preShowAt: addZonedDays(date.startsAt, -PRE_SHOW_DAYS, timeZone),
    liveAt: new Date(doors.getTime() - LIVE_BEFORE_DOORS_MS),
    liveEndsAt: new Date(date.endsAt.getTime() + LIVE_AFTER_END_MS),
    wrapEndsAt: addZonedDays(date.endsAt, WRAP_DAYS, timeZone),
  };
}

/** The windows of every scheduled date, oldest first (the event itself when it has no dates). */
export function modeWindows(input: Omit<ModeInput, 'now'>): ModeWindow[] {
  const scheduled = input.occurrences.filter((o) => o.status === 'scheduled');
  const dates =
    scheduled.length > 0
      ? scheduled.map((o) => ({ id: o.id, startsAt: o.startsAt, endsAt: o.endsAt }))
      : [{ id: null, startsAt: input.startsAt, endsAt: input.endsAt, doorsAt: input.doorsAt ?? null }];
  return dates
    .map((d) => modeWindow(d, input.timeZone))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

const earliest = (...dates: (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((min, d) => (d && (!min || d < min) ? d : min), null);

export function computeEventMode(input: ModeInput): ModeResult {
  const now = input.now.getTime();
  const windows = modeWindows(input);
  const live = windows.find((w) => w.liveAt.getTime() <= now && now < w.liveEndsAt.getTime());
  if (live)
    return { mode: 'live', window: live, nextChangeAt: live.liveEndsAt, nextMode: 'wrap', settled: false };
  const next = windows.find((w) => w.liveAt.getTime() > now) ?? null;
  const prev = [...windows].reverse().find((w) => w.liveEndsAt.getTime() <= now) ?? null;
  if (next && now >= next.preShowAt.getTime())
    return { mode: 'pre_show', window: next, nextChangeAt: next.liveAt, nextMode: 'live', settled: false };
  if (prev && now < prev.wrapEndsAt.getTime()) {
    // Until the next date's pre-show, or the end of the wrap (then planning, or settled).
    const nextChangeAt = earliest(prev.wrapEndsAt, next?.preShowAt ?? null) as Date;
    const nextMode: EventMode | null = !next
      ? null
      : next.preShowAt.getTime() <= prev.wrapEndsAt.getTime()
        ? 'pre_show'
        : 'planning';
    return { mode: 'wrap', window: prev, nextChangeAt, nextMode, settled: false };
  }
  if (next)
    return { mode: 'planning', window: next, nextChangeAt: next.preShowAt, nextMode: 'pre_show', settled: false };
  // Every date is over and its wrap too.
  const last = windows[windows.length - 1] as ModeWindow;
  return { mode: 'wrap', window: last, nextChangeAt: null, nextMode: null, settled: true };
}
