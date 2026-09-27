import { createHash } from 'node:crypto';
import type { TenantTx } from '@yayatoh/db';
import { canonicalJson, FloorplanDoc, layoutProblems, placedSeats, seatCount } from '@yayatoh/floorplan';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SEAT_STATUSES } from './domain/seat-state.ts';
import { BLOCK_REASONS, EVENT_LAYOUT_STATUSES, eventLayouts, eventSeats, layouts } from './schema.ts';

/** Parse and check a document; problems come back as `validation_failed` details. */
function validDoc(raw: unknown) {
  const parsed = FloorplanDoc.safeParse(raw);
  if (!parsed.success)
    throw new DomainError('validation_failed', 'Not a valid floor plan', {
      field: 'doc',
      issues: parsed.error.issues
        .slice(0, 20)
        .map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
    });
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
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { doc, checksum } = validDoc(input.doc);
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
  input: z.object({}),
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
  input: z.object({ id: z.uuid() }),
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

async function eventLayoutTx(tx: TenantTx, eventId: string, lock = false) {
  const q = tx.select().from(eventLayouts).where(eq(eventLayouts.eventId, eventId));
  const [row] = await (lock ? q.for('update') : q);
  return row ?? null;
}

/**
 * Give an event its floor plan (a copy of a saved one, or a document), replacing its seats. Seats
 * that keep their id keep their price and blocks, and a plan on sale stays on sale. Not once the
 * layout is locked (the first sale) or while any seat is held or sold.
 */
export const setEventLayoutCommand = tenantCommand({
  name: 'seating.setEventLayout',
  input: z
    .object({ eventId: z.uuid(), layoutId: z.uuid().optional(), doc: z.unknown().optional() })
    .refine((v) => (v.layoutId ? 1 : 0) + (v.doc !== undefined ? 1 : 0) === 1, {
      message: 'Give a saved floor plan or a document',
      path: ['layoutId'],
    }),
  output: z.object({ eventId: z.uuid(), seatCount: z.int(), status: z.enum(EVENT_LAYOUT_STATUSES) }),
  entitlement: 'seating',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const current = await eventLayoutTx(tx, input.eventId, true);
    if (current?.status === 'locked')
      throw new DomainError('invalid_state', 'Seats have been sold; the floor plan is locked', {
        reason: 'layout_locked',
      });
    const [busy] = await tx
      .select({ id: eventSeats.id })
      .from(eventSeats)
      .where(and(eq(eventSeats.eventId, input.eventId), inArray(eventSeats.status, ['held', 'sold'])))
      .limit(1);
    if (busy) throw new DomainError('invalid_state', 'Seats are held or sold', { reason: 'seats_in_use' });
    let raw: unknown = input.doc;
    if (input.layoutId) {
      const [l] = await tx.select().from(layouts).where(eq(layouts.id, input.layoutId));
      if (!l) throw new DomainError('not_found', 'Floor plan not found');
      raw = l.doc;
    }
    const { doc, checksum } = validDoc(raw);
    // Editing keeps what was set on seats that still exist: their price category and blocks.
    const kept = new Map(
      (
        await tx
          .select({
            seatUuid: eventSeats.seatUuid,
            ticketTypeId: eventSeats.ticketTypeId,
            status: eventSeats.status,
            blockReason: eventSeats.blockReason,
          })
          .from(eventSeats)
          .where(eq(eventSeats.eventId, input.eventId))
      ).map((s) => [s.seatUuid, s]),
    );
    await tx.delete(eventSeats).where(eq(eventSeats.eventId, input.eventId));
    const seats = placedSeats(doc);
    for (let i = 0; i < seats.length; i += 1000)
      await tx.insert(eventSeats).values(
        seats.slice(i, i + 1000).map((s) => ({
          orgId,
          eventId: input.eventId,
          seatUuid: s.seatId,
          label: s.label,
          itemId: s.itemId,
          sectionId: s.sectionId,
          accessible: s.accessible,
          ticketTypeId: kept.get(s.seatId)?.ticketTypeId ?? null,
          status: kept.get(s.seatId)?.status === 'blocked' ? ('blocked' as const) : ('available' as const),
          blockReason: kept.get(s.seatId)?.status === 'blocked' ? kept.get(s.seatId)?.blockReason : null,
        })),
      );
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
    else await tx.insert(eventLayouts).values({ orgId, eventId: input.eventId, ...values });
    return { eventId: input.eventId, seatCount: seats.length, status: values.status };
  },
  audit: (input, r) => ({
    action: 'seating.event_layout_set',
    targetType: 'event',
    targetId: input.eventId,
    data: { seats: r?.seatCount, layoutId: input.layoutId },
  }),
});

/** Put the event's seats on sale (draft → published). */
export const publishEventLayoutCommand = tenantCommand({
  name: 'seating.publishEventLayout',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ status: z.enum(EVENT_LAYOUT_STATUSES) }),
  entitlement: 'seating',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const current = await eventLayoutTx(tx, input.eventId, true);
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
  }),
});

const Selection = z.object({
  eventId: z.uuid(),
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
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(eventSeats)
      .set({ ticketTypeId: input.ticketTypeId, updatedAt: ctx.now })
      .where(and(eq(eventSeats.eventId, input.eventId), ne(eventSeats.status, 'sold'), selected(input)))
      .returning({ id: eventSeats.id });
    return { updated: rows.length };
  },
  audit: (input, r) => ({
    action: 'seating.assign_category',
    targetType: 'event',
    targetId: input.eventId,
    data: { ticketTypeId: input.ticketTypeId, updated: r?.updated },
  }),
});

/** Block available seats (channel, accessibility, kill) or unblock them. */
export const blockSeatsCommand = tenantCommand({
  name: 'seating.blockSeats',
  input: Selection.extend({ reason: z.enum(BLOCK_REASONS).nullable() }),
  output: z.object({ updated: z.int() }),
  entitlement: 'seating',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const rows = input.reason
      ? await tx
          .update(eventSeats)
          .set({ status: 'blocked', blockReason: input.reason, updatedAt: ctx.now })
          .where(
            and(eq(eventSeats.eventId, input.eventId), eq(eventSeats.status, 'available'), selected(input)),
          )
          .returning({ id: eventSeats.id })
      : await tx
          .update(eventSeats)
          .set({ status: 'available', blockReason: null, updatedAt: ctx.now })
          .where(
            and(eq(eventSeats.eventId, input.eventId), eq(eventSeats.status, 'blocked'), selected(input)),
          )
          .returning({ id: eventSeats.id });
    return { updated: rows.length };
  },
  audit: (input, r) => ({
    action: input.reason ? 'seating.block' : 'seating.unblock',
    targetType: 'event',
    targetId: input.eventId,
    data: { reason: input.reason, updated: r?.updated },
  }),
});

export const EventSeatingDto = z.object({
  status: z.enum(EVENT_LAYOUT_STATUSES),
  doc: FloorplanDoc,
  counts: z.record(z.enum(SEAT_STATUSES), z.int()),
  seats: z.array(
    z.object({
      seatUuid: z.uuid(),
      label: z.string(),
      status: z.enum(SEAT_STATUSES),
      ticketTypeId: z.uuid().nullable(),
      accessible: z.boolean(),
    }),
  ),
});

/** The event's floor plan and every seat's state (organizer console). */
export const eventSeatingQuery = tenantQuery({
  name: 'seating.eventSeating',
  input: z.object({ eventId: z.uuid() }),
  output: EventSeatingDto.nullable(),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const layout = await eventLayoutTx(tx, input.eventId);
    if (!layout) return null;
    const seats = await tx
      .select({
        seatUuid: eventSeats.seatUuid,
        label: eventSeats.label,
        status: eventSeats.status,
        ticketTypeId: eventSeats.ticketTypeId,
        accessible: eventSeats.accessible,
      })
      .from(eventSeats)
      .where(eq(eventSeats.eventId, input.eventId));
    const counts = { available: 0, held: 0, sold: 0, blocked: 0 };
    for (const s of seats) counts[s.status as keyof typeof counts]++;
    return {
      status: layout.status as (typeof EVENT_LAYOUT_STATUSES)[number],
      doc: FloorplanDoc.parse(layout.doc),
      counts,
      seats: seats.map((s) => ({ ...s, status: s.status as (typeof SEAT_STATUSES)[number] })),
    };
  },
});
