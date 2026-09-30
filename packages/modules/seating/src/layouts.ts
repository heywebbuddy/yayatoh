import { createHash } from 'node:crypto';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { findOccurrenceTx } from '@yayatoh/events';
import { canonicalJson, FloorplanDoc, layoutProblems, placedSeats, seatCount } from '@yayatoh/floorplan';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { reconcileAssignmentsTx } from './assignments.ts';
import { type ChartKey, chartKeyTx, onChart, publicDoc } from './chart.ts';
import { LIVE_SEAT_STATES, liveSeatState, publicAvailability, seatCounts } from './domain/live.ts';
import { activeAdaRule } from './domain/rules.ts';
import { SEAT_STATUSES, type SeatStatus } from './domain/seat-state.ts';
import { ruleStartTx, SeatingRuleDto, seatingRulesTx } from './rules.ts';
import {
  BLOCK_REASONS,
  EVENT_LAYOUT_STATUSES,
  eventLayouts,
  eventSeats,
  layouts,
  seatAssignments,
} from './schema.ts';

/** An organizer's image under a plan must be one of this org's own media files (M1.7g). */
const UNDERLAY_URL = /^\/media\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,120}$/;

/**
 * Parse and check a document; problems come back as `validation_failed` details. With `orgId`, an
 * image underlay must be served from that org's media (`/media/{org}/{asset}/{file}`), so a plan
 * never makes a buyer's browser fetch anything else.
 */
export function validDoc(raw: unknown, orgId?: string) {
  const parsed = FloorplanDoc.safeParse(raw);
  if (!parsed.success)
    throw new DomainError('validation_failed', 'Not a valid floor plan', {
      field: 'doc',
      issues: parsed.error.issues
        .slice(0, 20)
        .map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
    });
  const u = parsed.data.underlay;
  if (u && orgId) {
    const m = UNDERLAY_URL.exec(u.url);
    if (!m || m[1] !== orgId || (u.mediaId && m[2] !== u.mediaId))
      throw new DomainError('validation_failed', 'The plan image must be an uploaded image', {
        field: 'underlay',
        reason: 'underlay_url',
      });
  }
  const problems = layoutProblems(parsed.data);
  if (problems.length)
    throw new DomainError('validation_failed', 'The floor plan has problems', {
      field: 'doc',
      problems: problems.slice(0, 50),
    });
  return {
    doc: parsed.data,
    checksum: createHash('sha256').update(canonicalJson(parsed.data)).digest('hex'),
  };
}

export const LayoutSummaryDto = z.object({
  id: z.uuid(),
  name: z.string(),
  seatCount: z.int(),
  updatedAt: z.date(),
});

/** Create or update a reusable floor plan (a venue room). */
export const saveLayoutCommand = tenantCommand({
  name: 'seating.saveLayout',
  input: z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(120), doc: z.unknown() }),
  output: LayoutSummaryDto,
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const { doc, checksum } = validDoc(input.doc, requireOrg(ctx));
    const values = { name: input.name, doc, checksum, seatCount: seatCount(doc), updatedAt: ctx.now };
    const [row] = input.id
      ? await tx.update(layouts).set(values).where(eq(layouts.id, input.id)).returning()
      : await tx
          .insert(layouts)
          .values({ orgId: requireOrg(ctx), ...values })
          .returning();
    if (!row) throw new DomainError('not_found', 'Floor plan not found');
    return { id: row.id, name: row.name, seatCount: row.seatCount, updatedAt: row.updatedAt };
  },
  audit: (_i, r) => ({ action: 'seating.layout_save', targetType: 'layout', targetId: r?.id ?? null }),
});

export const listLayoutsQuery = tenantQuery({
  name: 'seating.listLayouts',
  // `eventId` (optional) scopes the authorization to that event: a planner picking a floor plan
  // for their event reads the org's plans through their event role (M4.2a).
  input: z.object({ eventId: z.uuid().optional() }),
  output: z.array(LayoutSummaryDto),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ tx }) =>
    (await tx.select().from(layouts).orderBy(asc(layouts.name))).map((l) => ({
      id: l.id,
      name: l.name,
      seatCount: l.seatCount,
      updatedAt: l.updatedAt,
    })),
});

export const getLayoutQuery = tenantQuery({
  name: 'seating.getLayout',
  input: z.object({ id: z.uuid(), eventId: z.uuid().optional() }),
  output: LayoutSummaryDto.extend({ doc: FloorplanDoc }),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [l] = await tx.select().from(layouts).where(eq(layouts.id, input.id));
    if (!l) throw new DomainError('not_found', 'Floor plan not found');
    return {
      id: l.id,
      name: l.name,
      seatCount: l.seatCount,
      updatedAt: l.updatedAt,
      doc: FloorplanDoc.parse(l.doc),
    };
  },
});

export async function eventLayoutTx(tx: TenantTx, eventId: string, key: ChartKey, lock = false) {
  const q = tx
    .select()
    .from(eventLayouts)
    .where(onChart(eventLayouts, eventId, key));
  const [row] = await (lock ? q.for('update') : q);
  return row ?? null;
}

/** The date a chart is for, in commands: omitted or null = the event plan (M1.7g). */
const DateInput = z.uuid().nullable().optional();

/**
 * Give an event its floor plan (a copy of a saved one, or a document), replacing its seats. Seats
 * that keep their id keep their price and blocks, and a plan on sale stays on sale. Not once the
 * layout is locked (the first sale) or while any seat is held or sold. With `occurrenceId`, the
 * chart that date uses (its own copy, or the event plan when it has none; M1.7g).
 */
export const setEventLayoutCommand = tenantCommand({
  name: 'seating.setEventLayout',
  input: z
    .object({
      eventId: z.uuid(),
      occurrenceId: DateInput,
      layoutId: z.uuid().optional(),
      doc: z.unknown().optional(),
    })
    .refine((v) => (v.layoutId ? 1 : 0) + (v.doc !== undefined ? 1 : 0) === 1, {
      message: 'Give a saved floor plan or a document',
      path: ['layoutId'],
    }),
  output: z.object({ eventId: z.uuid(), seatCount: z.int(), status: z.enum(EVENT_LAYOUT_STATUSES) }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const current = await eventLayoutTx(tx, input.eventId, key, true);
    if (current?.status === 'locked')
      throw new DomainError('invalid_state', 'Seats have been sold; the floor plan is locked', {
        reason: 'layout_locked',
      });
    const [busy] = await tx
      .select({ id: eventSeats.id })
      .from(eventSeats)
      .where(and(onChart(eventSeats, input.eventId, key), inArray(eventSeats.status, ['held', 'sold'])))
      .limit(1);
    if (busy) throw new DomainError('invalid_state', 'Seats are held or sold', { reason: 'seats_in_use' });
    let raw: unknown = input.doc;
    if (input.layoutId) {
      const [l] = await tx.select().from(layouts).where(eq(layouts.id, input.layoutId));
      if (!l) throw new DomainError('not_found', 'Floor plan not found');
      raw = l.doc;
    }
    const { doc, checksum } = validDoc(raw, orgId);
    // Editing keeps what was set on seats that still exist: their price category and blocks.
    const kept = new Map(
      (
        await tx
          .select({
            seatUuid: eventSeats.seatUuid,
            ticketTypeId: eventSeats.ticketTypeId,
            status: eventSeats.status,
            blockReason: eventSeats.blockReason,
            groupLabel: eventSeats.groupLabel,
          })
          .from(eventSeats)
          .where(onChart(eventSeats, input.eventId, key))
      ).map((s) => [s.seatUuid, s]),
    );
    await tx.delete(eventSeats).where(onChart(eventSeats, input.eventId, key));
    const seats = placedSeats(doc);
    for (let i = 0; i < seats.length; i += 1000)
      await tx.insert(eventSeats).values(
        seats.slice(i, i + 1000).map((s) => ({
          orgId,
          eventId: input.eventId,
          occurrenceId: key,
          seatUuid: s.seatId,
          label: s.label,
          itemId: s.itemId,
          sectionId: s.sectionId,
          accessible: s.accessible,
          ticketTypeId: kept.get(s.seatId)?.ticketTypeId ?? null,
          status: kept.get(s.seatId)?.status === 'blocked' ? ('blocked' as const) : ('available' as const),
          blockReason: kept.get(s.seatId)?.status === 'blocked' ? kept.get(s.seatId)?.blockReason : null,
          groupLabel: kept.get(s.seatId)?.groupLabel ?? null,
        })),
      );
    // Guests keep seats that still exist (and follow them to their table); others are unseated.
    await reconcileAssignmentsTx(tx, input.eventId, key, ctx);
    const values = {
      doc,
      checksum,
      seatCount: seats.length,
      sourceLayoutId: input.layoutId ?? current?.sourceLayoutId ?? null,
      // Editing a plan that is on sale keeps it on sale.
      status: current?.status === 'published' ? ('published' as const) : ('draft' as const),
      updatedAt: ctx.now,
    };
    if (current) await tx.update(eventLayouts).set(values).where(eq(eventLayouts.id, current.id));
    else
      await tx.insert(eventLayouts).values({ orgId, eventId: input.eventId, occurrenceId: key, ...values });
    return { eventId: input.eventId, seatCount: seats.length, status: values.status };
  },
  audit: (input, r) => ({
    action: 'seating.event_layout_set',
    targetType: 'event',
    targetId: input.eventId,
    data: { seats: r?.seatCount, layoutId: input.layoutId, occurrenceId: input.occurrenceId ?? null },
  }),
});

/** Put the event's seats on sale (draft → published). */
export const publishEventLayoutCommand = tenantCommand({
  name: 'seating.publishEventLayout',
  input: z.object({ eventId: z.uuid(), occurrenceId: DateInput }),
  output: z.object({ status: z.enum(EVENT_LAYOUT_STATUSES) }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const current = await eventLayoutTx(tx, input.eventId, key, true);
    if (!current) throw new DomainError('not_found', 'This event has no floor plan');
    if (current.status !== 'draft') return { status: current.status as 'published' | 'locked' };
    await tx
      .update(eventLayouts)
      .set({ status: 'published', updatedAt: ctx.now })
      .where(eq(eventLayouts.id, current.id));
    return { status: 'published' as const };
  },
  audit: (input) => ({
    action: 'seating.event_layout_publish',
    targetType: 'event',
    targetId: input.eventId,
    data: { occurrenceId: input.occurrenceId ?? null },
  }),
});

const Selection = z.object({
  eventId: z.uuid(),
  occurrenceId: DateInput,
  sectionIds: z.array(z.uuid()).max(200).default([]),
  itemIds: z.array(z.uuid()).max(5000).default([]),
  seatUuids: z.array(z.uuid()).max(20_000).default([]),
});
const selected = (s: z.output<typeof Selection>) =>
  or(
    s.sectionIds.length ? inArray(eventSeats.sectionId, s.sectionIds) : sql`false`,
    s.itemIds.length ? inArray(eventSeats.itemId, s.itemIds) : sql`false`,
    s.seatUuids.length ? inArray(eventSeats.seatUuid, s.seatUuids) : sql`false`,
  );

/**
 * Price seats: map sections, rows/tables or single seats to a ticket type (null takes them off
 * sale). Sold seats keep their category. Checkout checks the ticket type belongs to the event.
 */
export const assignSeatCategoryCommand = tenantCommand({
  name: 'seating.assignSeatCategory',
  input: Selection.extend({ ticketTypeId: z.uuid().nullable() }),
  output: z.object({ updated: z.int() }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const rows = await tx
      .update(eventSeats)
      .set({ ticketTypeId: input.ticketTypeId, updatedAt: ctx.now })
      .where(and(onChart(eventSeats, input.eventId, key), ne(eventSeats.status, 'sold'), selected(input)))
      .returning({ id: eventSeats.id });
    return { updated: rows.length };
  },
  audit: (input, r) => ({
    action: 'seating.assign_category',
    targetType: 'event',
    targetId: input.eventId,
    data: { ticketTypeId: input.ticketTypeId, updated: r?.updated, occurrenceId: input.occurrenceId ?? null },
  }),
});

/** Block available seats (channel, accessibility, kill) or unblock them. */
export const blockSeatsCommand = tenantCommand({
  name: 'seating.blockSeats',
  input: Selection.extend({ reason: z.enum(BLOCK_REASONS).nullable() }),
  output: z.object({ updated: z.int() }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const rows = input.reason
      ? await tx
          .update(eventSeats)
          .set({ status: 'blocked', blockReason: input.reason, updatedAt: ctx.now })
          .where(
            and(onChart(eventSeats, input.eventId, key), eq(eventSeats.status, 'available'), selected(input)),
          )
          .returning({ id: eventSeats.id })
      : await tx
          .update(eventSeats)
          // Unblocking a group's seat by hand gives it back to sale (and out of the group).
          .set({ status: 'available', blockReason: null, groupLabel: null, updatedAt: ctx.now })
          .where(
            and(
              onChart(eventSeats, input.eventId, key),
              eq(eventSeats.status, 'blocked'),
              // A guest's seat is freed by unseating them, not by unblocking.
              ne(eventSeats.blockReason, 'assigned'),
              selected(input),
            ),
          )
          .returning({ id: eventSeats.id });
    return { updated: rows.length };
  },
  audit: (input, r) => ({
    action: input.reason ? 'seating.block' : 'seating.unblock',
    targetType: 'event',
    targetId: input.eventId,
    data: { reason: input.reason, updated: r?.updated, occurrenceId: input.occurrenceId ?? null },
  }),
});

export const EventSeatingDto = z.object({
  /** The chart shown (M1.7g): null = the event plan, else the date with its own chart. */
  chart: z.uuid().nullable(),
  status: z.enum(EVENT_LAYOUT_STATUSES),
  doc: FloorplanDoc,
  /** Seats by state; a guest's seat counts as `assigned`, not `blocked` (M1.7f). */
  counts: z.record(z.enum(LIVE_SEAT_STATES), z.int()),
  seats: z.array(
    z.object({
      seatUuid: z.uuid(),
      label: z.string(),
      status: z.enum(SEAT_STATUSES),
      /** The status as the plan shows it: `assigned` apart from `blocked`. */
      state: z.enum(LIVE_SEAT_STATES),
      ticketTypeId: z.uuid().nullable(),
      accessible: z.boolean(),
    }),
  ),
});

/** The event's floor plan and every seat's state (organizer console). */
export const eventSeatingQuery = tenantQuery({
  name: 'seating.eventSeating',
  input: z.object({ eventId: z.uuid(), occurrenceId: DateInput }),
  output: EventSeatingDto.nullable(),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const layout = await eventLayoutTx(tx, input.eventId, key);
    if (!layout) return null;
    const seats = await tx
      .select({
        seatUuid: eventSeats.seatUuid,
        label: eventSeats.label,
        status: eventSeats.status,
        blockReason: eventSeats.blockReason,
        ticketTypeId: eventSeats.ticketTypeId,
        accessible: eventSeats.accessible,
      })
      .from(eventSeats)
      .where(onChart(eventSeats, input.eventId, key));
    const shown = seats.map((s) => ({
      seatUuid: s.seatUuid,
      label: s.label,
      status: s.status as SeatStatus,
      state: liveSeatState(s.status as SeatStatus, s.blockReason),
      ticketTypeId: s.ticketTypeId,
      accessible: s.accessible,
    }));
    return {
      chart: key,
      status: layout.status as (typeof EVENT_LAYOUT_STATUSES)[number],
      doc: FloorplanDoc.parse(layout.doc),
      counts: seatCounts(shown.map((s) => s.state)),
      seats: shown,
    };
  },
});

export const PublicSeatMapDto = z.object({
  /** The plan; its image underlay only when the organizer shows it to buyers (M1.7g). */
  doc: FloorplanDoc,
  /** The event's (or the chosen date's) start (seating rules count days before it). */
  startsAt: z.date(),
  /** The organizer's seating rules (their policy, shown to buyers; M1.7f). */
  rules: z.array(SeatingRuleDto),
  seats: z.array(
    z.object({
      seatUuid: z.uuid(),
      label: z.string(),
      ticketTypeId: z.uuid(),
      available: z.boolean(),
      accessible: z.boolean(),
    }),
  ),
});

/**
 * The buyer's seat map: the plan and, for each seat on sale, whether it can be chosen. Only
 * published or locked plans; nothing about who holds or bought a seat. Accessible seats kept back
 * by an enforced `ada_reserved` rule can't be chosen online until their release (M1.7f).
 */
export async function publicSeatMap(
  orgId: string,
  eventId: string,
  opts: {
    readonly now?: Date;
    /**
     * `staff`: the box office's view of the same map (M1.7f) — kept-back accessible seats stay
     * choosable there, since staff may sell one to a buyer who needs it (the rule still warns
     * or asks for an override).
     */
    readonly audience?: 'buyer' | 'staff';
    /** The date chosen (M1.7g): its own chart when it has one, else the event plan. */
    readonly occurrenceId?: string | null;
  } = {},
): Promise<z.infer<typeof PublicSeatMapDto> | null> {
  const now = opts.now ?? new Date();
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'seating.public-map' } });
  return withTenant(ctx, async (tx) => {
    const key = await chartKeyTx(tx, eventId, opts.occurrenceId);
    const layout = await eventLayoutTx(tx, eventId, key);
    if (!layout || layout.status === 'draft') return null;
    const seats = await tx
      .select({
        seatUuid: eventSeats.seatUuid,
        label: eventSeats.label,
        ticketTypeId: eventSeats.ticketTypeId,
        status: eventSeats.status,
        blockReason: eventSeats.blockReason,
        accessible: eventSeats.accessible,
      })
      .from(eventSeats)
      .where(and(onChart(eventSeats, eventId, key), sql`${eventSeats.ticketTypeId} is not null`));
    if (seats.length === 0) return null;
    const startsAt = await ruleStartTx(tx, eventId, opts.occurrenceId);
    if (!startsAt) return null;
    const rules = await seatingRulesTx(tx, eventId);
    const keptBack = opts.audience !== 'staff' && activeAdaRule(rules, startsAt, now)?.severity === 'enforce';
    const available = publicAvailability(
      seats.map((s) => ({ ...s, status: s.status as SeatStatus })),
      { accessibleKeptBack: keptBack },
    );
    return PublicSeatMapDto.parse({
      doc: publicDoc(layout.doc),
      startsAt,
      rules,
      seats: seats.map((s) => ({
        seatUuid: s.seatUuid,
        label: s.label,
        ticketTypeId: s.ticketTypeId,
        available: available.get(s.seatUuid) ?? false,
        accessible: s.accessible,
      })),
    });
  });
}

// ─── Per-date charts (M1.7g) ────────────────────────────────────────────────────────────────

export const DateChartDto = z.object({
  occurrenceId: z.uuid(),
  status: z.enum(EVENT_LAYOUT_STATUSES),
  seatCount: z.int(),
  /** Seats held or sold on this date's chart. */
  inUse: z.int(),
});
export type DateChartDto = z.infer<typeof DateChartDto>;

/** The dates of an event that have their own chart (every other date uses the event plan). */
export const dateChartsQuery = tenantQuery({
  name: 'seating.dateCharts',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(DateChartDto),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({
        occurrenceId: eventLayouts.occurrenceId,
        status: eventLayouts.status,
        seatCount: eventLayouts.seatCount,
      })
      .from(eventLayouts)
      .where(and(eq(eventLayouts.eventId, input.eventId), isNotNull(eventLayouts.occurrenceId)));
    if (rows.length === 0) return [];
    const busy = await tx
      .select({ occurrenceId: eventSeats.occurrenceId, n: sql<number>`count(*)::int` })
      .from(eventSeats)
      .where(
        and(
          eq(eventSeats.eventId, input.eventId),
          isNotNull(eventSeats.occurrenceId),
          inArray(eventSeats.status, ['held', 'sold']),
        ),
      )
      .groupBy(eventSeats.occurrenceId);
    const inUse = new Map(busy.map((b) => [b.occurrenceId, b.n]));
    return rows.map((r) => ({
      occurrenceId: r.occurrenceId as string,
      status: r.status as (typeof EVENT_LAYOUT_STATUSES)[number],
      seatCount: r.seatCount,
      inUse: inUse.get(r.occurrenceId) ?? 0,
    }));
  },
});

/**
 * Give one date of a multi-date event its own chart: a copy of the event plan (copy-on-write) —
 * the drawing, every seat's price and the organizer's blocks (channel, accessibility, kill, group
 * blocks with their name). Never holds, sales or seated guests: those stay on the event plan's
 * seats, and the copy's seats start free. Refused while any seat of the event plan is held or
 * sold for this date, or for an unknown date (sales from before the event had dates admit on
 * every date), since the copy would sell those seats twice. The copy is on sale when the event
 * plan is (a locked plan's copy is on sale, not locked: nothing is sold on it yet).
 */
export const giveDateOwnChartCommand = tenantCommand({
  name: 'seating.giveDateOwnChart',
  input: z.object({ eventId: z.uuid(), occurrenceId: z.uuid() }),
  output: z.object({ occurrenceId: z.uuid(), seatCount: z.int(), status: z.enum(EVENT_LAYOUT_STATUSES) }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const occ = await findOccurrenceTx(tx, input.occurrenceId);
    if (!occ || occ.eventId !== input.eventId)
      throw new DomainError('not_found', 'Date not found', { field: 'occurrenceId' });
    if (occ.status !== 'scheduled')
      throw new DomainError('invalid_state', 'This date is cancelled', { reason: 'date_cancelled' });
    // The event plan is locked for update: sales on it wait for this copy (and the other way round).
    const plan = await eventLayoutTx(tx, input.eventId, null, true);
    if (!plan) throw new DomainError('not_found', 'This event has no floor plan');
    if (await eventLayoutTx(tx, input.eventId, input.occurrenceId))
      throw new DomainError('conflict', 'This date already has its own chart', { reason: 'date_has_chart' });
    const [busy] = await tx
      .select({ id: eventSeats.id })
      .from(eventSeats)
      .where(
        and(
          onChart(eventSeats, input.eventId, null),
          inArray(eventSeats.status, ['held', 'sold']),
          or(isNull(eventSeats.heldForOccurrenceId), eq(eventSeats.heldForOccurrenceId, input.occurrenceId)),
        ),
      )
      .limit(1);
    if (busy)
      throw new DomainError('invalid_state', 'Seats of the event plan are held or sold for this date', {
        reason: 'seats_in_use',
      });
    const doc = FloorplanDoc.parse(plan.doc);
    const seats = await tx
      .select({
        seatUuid: eventSeats.seatUuid,
        label: eventSeats.label,
        itemId: eventSeats.itemId,
        sectionId: eventSeats.sectionId,
        ticketTypeId: eventSeats.ticketTypeId,
        accessible: eventSeats.accessible,
        status: eventSeats.status,
        blockReason: eventSeats.blockReason,
        groupLabel: eventSeats.groupLabel,
      })
      .from(eventSeats)
      .where(onChart(eventSeats, input.eventId, null));
    const prior = new Map(
      (
        await tx
          .select({ seatUuid: seatAssignments.seatUuid, priorBlock: seatAssignments.priorBlock })
          .from(seatAssignments)
          .where(onChart(seatAssignments, input.eventId, null))
      ).map((a) => [a.seatUuid, a.priorBlock]),
    );
    const copied = seats.map((s) => copySeat({ ...s, priorBlock: prior.get(s.seatUuid) ?? null }));
    for (let i = 0; i < copied.length; i += 1000)
      await tx.insert(eventSeats).values(
        copied.slice(i, i + 1000).map((s) => ({
          orgId,
          eventId: input.eventId,
          occurrenceId: input.occurrenceId,
          ...s,
        })),
      );
    const status = plan.status === 'draft' ? ('draft' as const) : ('published' as const);
    await tx.insert(eventLayouts).values({
      orgId,
      eventId: input.eventId,
      occurrenceId: input.occurrenceId,
      sourceLayoutId: plan.sourceLayoutId,
      doc,
      checksum: plan.checksum,
      seatCount: plan.seatCount,
      status,
      publicMap: plan.publicMap,
      finderMode: plan.finderMode,
    });
    return { occurrenceId: input.occurrenceId, seatCount: copied.length, status };
  },
  audit: (input, r) => ({
    action: 'seating.date_chart_create',
    targetType: 'event',
    targetId: input.eventId,
    data: { occurrenceId: input.occurrenceId, seats: r?.seatCount },
  }),
});

/**
 * A seat of the event plan as its copy on a date's own chart starts: same price, same organizer
 * block (a group block keeps its name); a guest's seat, a hold or a sale comes back free
 * (M1.7g copy-on-write; pure, unit-tested).
 */
export function copySeat(s: {
  seatUuid: string;
  label: string;
  itemId: string;
  sectionId: string | null;
  ticketTypeId: string | null;
  accessible: boolean;
  status: string;
  blockReason: string | null;
  groupLabel: string | null;
  /** When a guest sits here: the block the seat had before (it comes back on the copy). */
  priorBlock?: string | null;
}) {
  const reason =
    s.status !== 'blocked' ? null : s.blockReason === 'assigned' ? (s.priorBlock ?? null) : s.blockReason;
  const block = (SEAT_COPY_BLOCKS as readonly string[]).includes(reason ?? '')
    ? (reason as (typeof SEAT_COPY_BLOCKS)[number])
    : null;
  return {
    seatUuid: s.seatUuid,
    label: s.label,
    itemId: s.itemId,
    sectionId: s.sectionId,
    ticketTypeId: s.ticketTypeId,
    accessible: s.accessible,
    status: block ? ('blocked' as const) : ('available' as const),
    blockReason: block,
    groupLabel: block === 'group' ? s.groupLabel : null,
  };
}

const SEAT_COPY_BLOCKS = [...BLOCK_REASONS, 'group'] as const;

/**
 * A date goes back to the event plan: its own chart, seats and guest seats on it are removed.
 * Refused once anything was sold on it (locked) or while seats are held there.
 */
export const removeDateChartCommand = tenantCommand({
  name: 'seating.removeDateChart',
  // It unseats the guests seated on that chart for good (M1.2e: refused while impersonating).
  category: 'delete',
  input: z.object({ eventId: z.uuid(), occurrenceId: z.uuid() }),
  output: z.object({ occurrenceId: z.uuid(), unseated: z.int() }),
  entitlement: 'seating',
  permission: 'seating:write',
  handler: async ({ input, tx }) => {
    const chart = await eventLayoutTx(tx, input.eventId, input.occurrenceId, true);
    if (!chart) throw new DomainError('not_found', 'This date has no chart of its own');
    if (chart.status === 'locked')
      throw new DomainError('invalid_state', 'Seats have been sold; the chart is locked', {
        reason: 'layout_locked',
      });
    const [busy] = await tx
      .select({ id: eventSeats.id })
      .from(eventSeats)
      .where(
        and(
          onChart(eventSeats, input.eventId, input.occurrenceId),
          inArray(eventSeats.status, ['held', 'sold']),
        ),
      )
      .limit(1);
    if (busy) throw new DomainError('invalid_state', 'Seats are held or sold', { reason: 'seats_in_use' });
    const gone = await tx
      .delete(seatAssignments)
      .where(onChart(seatAssignments, input.eventId, input.occurrenceId))
      .returning({ id: seatAssignments.id });
    await tx.delete(eventSeats).where(onChart(eventSeats, input.eventId, input.occurrenceId));
    await tx.delete(eventLayouts).where(eq(eventLayouts.id, chart.id));
    return { occurrenceId: input.occurrenceId, unseated: gone.length };
  },
  audit: (input, r) => ({
    action: 'seating.date_chart_remove',
    targetType: 'event',
    targetId: input.eventId,
    data: { occurrenceId: input.occurrenceId, unseated: r?.unseated },
  }),
});

/**
 * Whether a media file may be served to the public as a plan's image (M1.7g): only an image the
 * organizer shows on the buyer's map of a chart on sale (of any of the org's events: a duplicated
 * event reuses its source's image). Otherwise only the org's members see it.
 */
export async function publicUnderlayShown(orgId: string, assetId: string): Promise<boolean> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'seating.underlay' } });
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: eventLayouts.id })
      .from(eventLayouts)
      .where(
        and(
          ne(eventLayouts.status, 'draft'),
          sql`${eventLayouts.doc} -> 'underlay' ->> 'mediaId' = ${assetId}`,
          sql`(${eventLayouts.doc} -> 'underlay' ->> 'showOnMap')::boolean is true`,
        ),
      )
      .limit(1);
    return Boolean(row);
  });
}
