/**
 * Schedule checks for the lightweight agenda (M1.4f). Pure: no database, no DOM, so the console,
 * the commands and the tests share one definition.
 *
 * Times are half-open intervals [start, end): a session ending at 10:00 and one starting at
 * 10:00 in the same room do not conflict.
 */

export interface ScheduleItem {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomId: string | null;
  readonly speakerIds: readonly string[];
}

export type ScheduleWarning =
  | {
      readonly kind: 'room_overlap';
      readonly sessionId: string;
      readonly otherId: string;
      readonly roomId: string;
    }
  | {
      readonly kind: 'speaker_overlap';
      readonly sessionId: string;
      readonly otherId: string;
      readonly speakerId: string;
    }
  | { readonly kind: 'outside_event'; readonly sessionId: string };

export function overlaps(
  a: { readonly startsAt: Date; readonly endsAt: Date },
  b: { readonly startsAt: Date; readonly endsAt: Date },
): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/**
 * Every conflict in a schedule: two sessions in the same room at overlapping times, a speaker in
 * two overlapping sessions, and (given the event's span) sessions outside the event. Each pair is
 * reported once, earlier session first (ties by id), so the output is deterministic.
 */
export function scheduleWarnings(
  items: readonly ScheduleItem[],
  span?: { readonly startsAt: Date; readonly endsAt: Date },
): ScheduleWarning[] {
  const sorted = [...items].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const out: ScheduleWarning[] = [];
  for (const [i, a] of sorted.entries()) {
    if (span && (a.startsAt < span.startsAt || a.endsAt > span.endsAt))
      out.push({ kind: 'outside_event', sessionId: a.id });
    for (const b of sorted.slice(i + 1)) {
      // Sorted by start: once b starts at or after a ends, no later session overlaps a.
      if (b.startsAt.getTime() >= a.endsAt.getTime()) break;
      if (a.roomId !== null && a.roomId === b.roomId)
        out.push({ kind: 'room_overlap', sessionId: a.id, otherId: b.id, roomId: a.roomId });
      for (const speakerId of a.speakerIds)
        if (b.speakerIds.includes(speakerId))
          out.push({ kind: 'speaker_overlap', sessionId: a.id, otherId: b.id, speakerId });
    }
  }
  return out;
}

/** The warnings that concern one session (either side of a pair), with `otherId` the other one. */
export function warningsFor(warnings: readonly ScheduleWarning[], sessionId: string): ScheduleWarning[] {
  return warnings.flatMap((w): ScheduleWarning[] => {
    if (w.sessionId === sessionId) return [w];
    if (w.kind !== 'outside_event' && w.otherId === sessionId)
      return [{ ...w, sessionId, otherId: w.sessionId }];
    return [];
  });
}

/** The calendar day (`YYYY-MM-DD`) of an instant in a timezone. */
export function localDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Sessions grouped by the day they start on in the event's timezone (not the viewer's), days in
 * order and sessions by start time, then end, then title.
 */
export function groupByDay<
  T extends { readonly startsAt: Date; readonly endsAt: Date; readonly title: string },
>(items: readonly T[], timeZone: string): { day: string; items: T[] }[] {
  const sorted = [...items].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.endsAt.getTime() - b.endsAt.getTime() ||
      a.title.localeCompare(b.title),
  );
  const days = new Map<string, T[]>();
  for (const item of sorted) {
    const day = localDay(item.startsAt, timeZone);
    const list = days.get(day);
    if (list) list.push(item);
    else days.set(day, [item]);
  }
  return [...days].map(([day, list]) => ({ day, items: list }));
}
