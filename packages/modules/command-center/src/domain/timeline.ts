import type { ModeResult, ModeWindow } from './modes.ts';

/**
 * The "upcoming" timeline widget (M3.2): the next mode changes of the current date, the event's
 * next dates and its next program sessions, soonest first. Pure.
 */
export const TIMELINE_KINDS = [
  'preShow',
  'live',
  'start',
  'end',
  'wrap',
  'wrapEnd',
  'date',
  'session',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export interface TimelineItem {
  readonly kind: TimelineKind;
  readonly at: Date;
  /** A session's title (the only free text on the timeline; organizer-written, shown to staff). */
  readonly title: string | null;
}

export const TIMELINE_LIMIT = 8;

export function timelineItems(opts: {
  readonly mode: ModeResult;
  readonly windows: readonly ModeWindow[];
  readonly sessions: readonly { readonly title: string; readonly startsAt: Date }[];
  readonly now: Date;
  readonly limit?: number;
}): TimelineItem[] {
  const w = opts.mode.window;
  const items: TimelineItem[] = [
    { kind: 'preShow', at: w.preShowAt, title: null },
    { kind: 'live', at: w.liveAt, title: null },
    { kind: 'start', at: w.startsAt, title: null },
    { kind: 'end', at: w.endsAt, title: null },
    { kind: 'wrap', at: w.liveEndsAt, title: null },
    { kind: 'wrapEnd', at: w.wrapEndsAt, title: null },
    ...opts.windows
      .filter((d) => d.occurrenceId !== null && d.occurrenceId !== w.occurrenceId)
      .map((d) => ({ kind: 'date' as const, at: d.startsAt, title: null })),
    ...opts.sessions.map((s) => ({ kind: 'session' as const, at: s.startsAt, title: s.title })),
  ];
  const order = (k: TimelineKind) => TIMELINE_KINDS.indexOf(k);
  return items
    .filter((i) => i.at.getTime() > opts.now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime() || order(a.kind) - order(b.kind))
    .slice(0, opts.limit ?? TIMELINE_LIMIT);
}
