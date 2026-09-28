import type { TenantTx } from '@yayatoh/db';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { eventLayouts } from './schema.ts';

/**
 * Per-date charts (M1.7g). A chart is identified by its key: `null` for the event plan (every date
 * without its own chart, and single-date events), or the id of the date that has its own copy.
 * Seats, holds, sales and guest seats belong to one chart.
 */
export type ChartKey = string | null;

/** Rows of one chart of an event (`event_layouts`, `event_seats`, `seat_assignments`). */
export function onChart(
  t: { readonly eventId: PgColumn; readonly occurrenceId: PgColumn },
  eventId: string,
  key: ChartKey,
): SQL {
  return and(eq(t.eventId, eventId), key ? eq(t.occurrenceId, key) : isNull(t.occurrenceId)) as SQL;
}

/**
 * The chart a date uses: its own copy when it has one, otherwise the event plan. No date (a
 * single-date event, or "the event plan" in the console) is the event plan.
 */
export async function chartKeyTx(
  tx: TenantTx,
  eventId: string,
  occurrenceId: string | null | undefined,
): Promise<ChartKey> {
  if (!occurrenceId) return null;
  const [row] = await tx
    .select({ id: eventLayouts.id })
    .from(eventLayouts)
    .where(onChart(eventLayouts, eventId, occurrenceId));
  return row ? occurrenceId : null;
}

/**
 * A plan as buyers and guests see it: the organizer's image underlay only when they chose to
 * show it on the buyer's map (M1.7g).
 */
export function publicDoc(raw: unknown): FloorplanDoc {
  const doc = FloorplanDoc.parse(raw);
  return doc.underlay?.showOnMap ? doc : { ...doc, underlay: null };
}
