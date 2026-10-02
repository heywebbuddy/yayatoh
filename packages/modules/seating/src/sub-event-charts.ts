import { isForeignKeyViolation, isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { findOccurrenceTx } from '@yayatoh/events';
import { placedSeats } from '@yayatoh/floorplan';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type ChartKey, chartKeyTx } from './chart.ts';
import { eventLayoutTx, validDoc } from './layouts.ts';
import { layouts, subEventCharts } from './schema.ts';

/**
 * Per-sub-event charts (M4.1c). A wedding's sub-events (ceremony, reception…) may each have
 * their own drawing. The chart a sub-event uses: its own; else the chart of the date it is linked
 * to (M1.7g: that date's own chart, else the event plan); else the event plan; else none. The
 * sub-event itself lives in the guests module (same tier): callers pass its id and date, and a
 * hand-written foreign key keeps the chart on a sub-event of the same event.
 */

export const SUB_EVENT_CHART_SOURCES = ['sub_event', 'date', 'event', 'none'] as const;
export type SubEventChartSource = (typeof SUB_EVENT_CHART_SOURCES)[number];

export interface SubEventRef {
  readonly id: string;
  /** The event date the sub-event is linked to, if any. */
  readonly occurrenceId: string | null;
}

export const SubEventChartDto = z.object({
  subEventId: z.uuid(),
  source: z.enum(SUB_EVENT_CHART_SOURCES),
  /** For `date` and `event`: the M1.7g chart key used (null = the event plan). */
  chartKey: z.uuid().nullable(),
  seatCount: z.int(),
  /** For `sub_event`: the library layout it was copied from (null = a copy of its fallback). */
  sourceLayoutId: z.uuid().nullable(),
});
export type SubEventChartDto = z.infer<typeof SubEventChartDto>;

/** The chart a sub-event uses (see the file comment). */
export async function resolveSubEventChartTx(
  tx: TenantTx,
  eventId: string,
  ref: SubEventRef,
): Promise<SubEventChartDto> {
  const [own] = await tx
    .select()
    .from(subEventCharts)
    .where(and(eq(subEventCharts.eventId, eventId), eq(subEventCharts.subEventId, ref.id)));
  if (own)
    return {
      subEventId: ref.id,
      source: 'sub_event',
      chartKey: null,
      seatCount: own.seatCount,
      sourceLayoutId: own.sourceLayoutId,
    };
  const key: ChartKey = await chartKeyTx(tx, eventId, ref.occurrenceId);
  const chart = await eventLayoutTx(tx, eventId, key);
  if (!chart)
    return { subEventId: ref.id, source: 'none', chartKey: null, seatCount: 0, sourceLayoutId: null };
  return {
    subEventId: ref.id,
    source: key ? 'date' : 'event',
    chartKey: key,
    seatCount: chart.seatCount,
    sourceLayoutId: null,
  };
}

const Ref = z.object({ id: z.uuid(), occurrenceId: z.uuid().nullable() });

/** The chart each given sub-event uses (the guests page passes the event's sub-events). */
export const subEventChartsQuery = tenantQuery({
  name: 'seating.subEventCharts',
  input: z.object({ eventId: z.uuid(), subEvents: z.array(Ref).max(50) }),
  output: z.array(SubEventChartDto),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const out: SubEventChartDto[] = [];
    for (const ref of input.subEvents) out.push(await resolveSubEventChartTx(tx, input.eventId, ref));
    return out;
  },
});

/**
 * Give a sub-event its own chart: a copy of a saved floor plan (`layoutId`), or of the chart it
 * uses now (its date's, else the event plan). Refused when it already has one
 * (`sub_event_has_chart`), when there is nothing to copy (`no_chart`), or when the sub-event is
 * not this event's (`not_found`, from the foreign key).
 */
export const giveSubEventOwnChartCommand = tenantCommand({
  name: 'seating.giveSubEventOwnChart',
  input: z.object({
    eventId: z.uuid(),
    subEventId: z.uuid(),
    occurrenceId: z.uuid().nullable().default(null),
    layoutId: z.uuid().optional(),
  }),
  output: SubEventChartDto,
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (input.occurrenceId) {
      const occ = await findOccurrenceTx(tx, input.occurrenceId);
      if (!occ || occ.eventId !== input.eventId)
        throw new DomainError('not_found', 'Date not found', { field: 'occurrenceId' });
    }
    let raw: unknown;
    if (input.layoutId) {
      const [l] = await tx.select().from(layouts).where(eq(layouts.id, input.layoutId));
      if (!l) throw new DomainError('not_found', 'Floor plan not found', { field: 'layoutId' });
      raw = l.doc;
    } else {
      const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
      const chart = await eventLayoutTx(tx, input.eventId, key);
      if (!chart) throw new DomainError('invalid_state', 'There is no chart to copy', { reason: 'no_chart' });
      raw = chart.doc;
    }
    const { doc, checksum } = validDoc(raw, orgId);
    const seatCount = placedSeats(doc).length;
    await tx
      .insert(subEventCharts)
      .values({
        orgId,
        eventId: input.eventId,
        subEventId: input.subEventId,
        sourceLayoutId: input.layoutId ?? null,
        doc,
        checksum,
        seatCount,
      })
      .catch((err) => {
        if (isUniqueViolation(err))
          throw new DomainError('conflict', 'This sub-event already has its own chart', {
            reason: 'sub_event_has_chart',
          });
        if (isForeignKeyViolation(err)) throw new DomainError('not_found', 'Sub-event not found');
        throw err;
      });
    return {
      subEventId: input.subEventId,
      source: 'sub_event',
      chartKey: null,
      seatCount,
      sourceLayoutId: input.layoutId ?? null,
    };
  },
  audit: (input, r) => ({
    action: 'seating.sub_event_chart_create',
    targetType: 'event',
    targetId: input.eventId,
    data: { subEventId: input.subEventId, layoutId: input.layoutId ?? null, seats: r?.seatCount },
  }),
});

/** The sub-event goes back to its date's chart (or the event plan). */
export const removeSubEventChartCommand = tenantCommand({
  name: 'seating.removeSubEventChart',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), subEventId: z.uuid() }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, tx }) => {
    const gone = await tx
      .delete(subEventCharts)
      .where(and(eq(subEventCharts.eventId, input.eventId), eq(subEventCharts.subEventId, input.subEventId)))
      .returning({ id: subEventCharts.id });
    if (gone.length === 0) throw new DomainError('not_found', 'This sub-event has no chart of its own');
    return { removed: true };
  },
  audit: (input) => ({
    action: 'seating.sub_event_chart_remove',
    targetType: 'event',
    targetId: input.eventId,
    data: { subEventId: input.subEventId },
  }),
});
