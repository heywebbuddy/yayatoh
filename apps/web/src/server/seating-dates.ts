import 'server-only';
import { listOccurrencesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { dateChartsQuery } from '@yayatoh/seating';
import type { ConsoleData } from './console.ts';
import { ports } from './ports.ts';

export interface SeatingDate {
  readonly id: string;
  readonly startsAt: Date;
  readonly cancelled: boolean;
  /** This date has its own chart (M1.7g); otherwise it uses the event plan. */
  readonly own: boolean;
  /** Seats held or sold on its own chart. */
  readonly inUse: number;
}

/**
 * The event's dates for the seating views (M1.7g) and the one chosen with `?date=`: null means
 * the event plan (single-date events always). A date id that isn't the event's is ignored.
 */
export async function seatingDates(
  data: ConsoleData,
  eventId: string,
  requested: string | undefined,
): Promise<{ dates: SeatingDate[]; date: SeatingDate | null }> {
  const occurrences = await executeQuery(listOccurrencesQuery, { eventId }, data.ctx, ports);
  if (occurrences.length === 0) return { dates: [], date: null };
  const own = new Map(
    (await executeQuery(dateChartsQuery, { eventId }, data.ctx, ports)).map((c) => [c.occurrenceId, c]),
  );
  const dates = occurrences.map((o) => ({
    id: o.id,
    startsAt: o.startsAt,
    cancelled: o.status === 'cancelled',
    own: own.has(o.id),
    inUse: own.get(o.id)?.inUse ?? 0,
  }));
  return { dates, date: dates.find((d) => d.id === requested) ?? null };
}
