import { AttendeeFilter, AttendeeLabel, attendeesByIdsTx, resolveAttendeeIdsTx } from '@yayatoh/attendees';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction } from '@yayatoh/platform';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { releaseAttendeeSeatsTx } from './assignments.ts';
import { type BulkAssignUndo, type ChunkPerson, planChunk, planUndo } from './domain/bulk-assign.ts';
import { activeAdaRule } from './domain/rules.ts';
import { seatingRulesTx } from './rules.ts';
import { ASSIGNABLE_BLOCKS, eventLayouts, eventSeats, seatAssignments } from './schema.ts';

/** Where a bulk assignment seats people: a table or row, a section, anywhere, or a group's block. */
export const BulkAssignTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), itemId: z.uuid() }),
  z.object({ kind: z.literal('section'), sectionId: z.uuid() }),
  z.object({ kind: z.literal('best') }),
  z.object({ kind: z.literal('group'), label: AttendeeLabel }),
]);
export type BulkAssignTarget = z.infer<typeof BulkAssignTarget>;

const Params = z.object({
  target: BulkAssignTarget,
  /** Staff chose to use kept-back accessible seats on purpose (audited). */
  overrideRules: z.boolean().default(false),
});

const PriorSeatJson = z.object({
  seatUuid: z.uuid(),
  pinned: z.boolean(),
  priorBlock: z.enum(ASSIGNABLE_BLOCKS).nullable(),
});
const UndoJson = z.object({ given: z.uuid(), prev: PriorSeatJson.nullable() });

async function planTx(tx: TenantTx, eventId: string) {
  const [row] = await tx
    .select({ doc: eventLayouts.doc })
    .from(eventLayouts)
    .where(eq(eventLayouts.eventId, eventId));
  if (!row) throw new DomainError('not_found', 'This event has no floor plan');
  return FloorplanDoc.parse(row.doc);
}

/** Every seat's position in the plan: items in drawing order, seats in their item's order. */
const planOrderOf = (doc: FloorplanDoc) =>
  new Map(
    doc.items
      .flatMap((item) => (item.kind === 'object' ? [] : item.seats.map((s) => s.id)))
      .map((id, i) => [id, i]),
  );

/** The seats a target covers, as a SQL condition. */
function targetWhere(doc: FloorplanDoc, t: BulkAssignTarget) {
  switch (t.kind) {
    case 'item': {
      const item = doc.items.find((i) => i.id === t.itemId);
      if (!item || item.kind === 'object')
        throw new DomainError('not_found', 'No such table or row', { field: 'itemId' });
      return eq(eventSeats.itemId, item.id);
    }
    case 'section':
      if (!doc.sections.some((s) => s.id === t.sectionId))
        throw new DomainError('not_found', 'No such section', { field: 'sectionId' });
      return eq(eventSeats.sectionId, t.sectionId);
    case 'group':
      return eq(eventSeats.groupLabel, t.label);
    case 'best':
      return undefined;
  }
}

/**
 * Seat many people at once (M1.8f), on the bulk framework: the selected attendees, or everyone
 * matching the list's filters, go to a table or row, a section, the best available seats in the
 * whole plan, or their group's kept-back block — in plan order, 100 per chunk, with progress.
 *
 * - People already seated in the target stay put; people seated elsewhere move.
 * - Per-person failures: `not_enough_seats` (the target is full), `seated_by_ticket` (they bought
 *   a seat), `attendee_cancelled`, `not_found`. The others are seated: a partial result.
 * - Seating rules (M1.7f): while accessible seats are kept back, they are used last and each
 *   such placement is a warning (`ada_kept_back`); an enforced rule keeps them out of reach
 *   unless `overrideRules` (audited with the operation).
 * - Undo (10 minutes) puts everyone back exactly where they were: the seat they had (pinned or
 *   not, with its channel/accessibility/group block remembered), or no seat.
 * - Seats change through the same statements as one-by-one assignment, so the live seat feed
 *   publishes every chunk.
 */
export const seatAssignAction = defineBulkAction({
  key: 'seating.bulkAssign',
  entitlement: 'seating',
  permission: 'seating:write',
  params: Params,
  filter: AttendeeFilter,
  chunkSize: 100,
  undoWindowMs: 10 * 60_000,
  auditParams: (p) => ({
    target: p.target.kind,
    ...(p.target.kind === 'group' ? { group: p.target.label } : {}),
    ...(p.overrideRules ? { overrideRules: true } : {}),
  }),
  resolve: resolveAttendeeIdsTx,
  run: async (tx, ctx, ids, params, meta) => {
    if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
    const eventId = meta.eventId;
    const orgId = requireOrg(ctx);
    const doc = await planTx(tx, eventId);
    const inTarget = targetWhere(doc, params.target);
    const order = planOrderOf(doc);

    // Who: this event's active attendees, not already seated by a ticket they bought.
    const people = new Map((await attendeesByIdsTx(tx, ids)).map((p) => [p.id, p]));
    const ticketIds = [...people.values()].flatMap((p) => (p.ticketId ? [p.ticketId] : []));
    const bought = ticketIds.length
      ? new Set(
          (
            await tx
              .select({ ticketId: eventSeats.ticketId })
              .from(eventSeats)
              .where(
                and(
                  eq(eventSeats.eventId, eventId),
                  eq(eventSeats.status, 'sold'),
                  inArray(eventSeats.ticketId, ticketIds),
                ),
              )
          ).map((r) => r.ticketId),
        )
      : new Set<string | null>();

    // Lock the target's seats in one fixed order (concurrent assignments can't deadlock).
    await tx.execute(sql`set local lock_timeout = '5s'`);
    const seats = (
      await tx
        .select({
          seatUuid: eventSeats.seatUuid,
          itemId: eventSeats.itemId,
          status: eventSeats.status,
          blockReason: eventSeats.blockReason,
          groupLabel: eventSeats.groupLabel,
          accessible: eventSeats.accessible,
        })
        .from(eventSeats)
        .where(and(eq(eventSeats.eventId, eventId), inTarget))
        .orderBy(eventSeats.seatUuid)
        .for('update')
    ).sort((x, y) => (order.get(x.seatUuid) ?? 0) - (order.get(y.seatUuid) ?? 0));
    const targetSeats = new Set(seats.map((s) => s.seatUuid));
    const current = new Map(
      (
        await tx
          .select({
            attendeeId: seatAssignments.attendeeId,
            seatUuid: seatAssignments.seatUuid,
            pinned: seatAssignments.pinned,
            priorBlock: seatAssignments.priorBlock,
          })
          .from(seatAssignments)
          .where(and(eq(seatAssignments.eventId, eventId), inArray(seatAssignments.attendeeId, [...ids])))
      ).map((c) => [c.attendeeId, c]),
    );

    const chunk: ChunkPerson[] = ids.map((id) => {
      const p = people.get(id);
      const refused =
        !p || p.eventId !== eventId
          ? ('not_found' as const)
          : p.status !== 'active'
            ? ('attendee_cancelled' as const)
            : p.ticketId && bought.has(p.ticketId)
              ? ('seated_by_ticket' as const)
              : null;
      const c = current.get(id);
      // "Best available": anyone already seated keeps their seat.
      const alreadyThere = Boolean(c && (params.target.kind === 'best' || targetSeats.has(c.seatUuid)));
      return { attendeeId: id, refused, alreadyThere };
    });

    const rules = await seatingRulesTx(tx, eventId);
    const event = rules.length ? await findEventTx(tx, eventId) : null;
    const ada = event ? activeAdaRule(rules, event.startsAt, ctx.now) : null;
    const plan = planChunk(
      seats.map((s) => ({
        seatUuid: s.seatUuid,
        accessible: s.accessible,
        free:
          params.target.kind === 'group'
            ? s.status === 'blocked' && s.blockReason === 'group' && s.groupLabel === params.target.label
            : s.status === 'available',
      })),
      chunk,
      { skipAccessible: ada?.severity === 'enforce' && !params.overrideRules },
    );

    // Movers leave their old seats first; the release trigger gives each back what it had.
    const moving = plan.placements.map((p) => p.attendeeId).filter((id) => current.has(id));
    await releaseAttendeeSeatsTx(tx, ctx, moving);
    const seatOf = new Map(seats.map((s) => [s.seatUuid, s]));
    if (plan.placements.length) {
      const wanted = plan.placements.map((p) => p.seatUuid);
      const taken = await tx
        .update(eventSeats)
        .set({ status: 'blocked', blockReason: 'assigned', updatedAt: ctx.now })
        .where(
          and(
            eq(eventSeats.eventId, eventId),
            inArray(eventSeats.seatUuid, wanted),
            sql`(${eventSeats.status} = 'available' or (${eventSeats.status} = 'blocked' and ${eventSeats.blockReason} = 'group'))`,
          ),
        )
        .returning({ seatUuid: eventSeats.seatUuid });
      if (taken.length !== wanted.length)
        throw new DomainError('conflict', 'Some of those seats were just taken', { reason: 'seats_taken' });
      await tx.insert(seatAssignments).values(
        plan.placements.map((p) => {
          const s = seatOf.get(p.seatUuid);
          return {
            orgId,
            eventId,
            attendeeId: p.attendeeId,
            itemId: s?.itemId as string,
            seatUuid: p.seatUuid,
            pinned: false,
            priorBlock: s?.status === 'blocked' && s.blockReason === 'group' ? ('group' as const) : null,
          };
        }),
      );
    }
    const failed = new Map(plan.failures.map((f) => [f.attendeeId, f.code]));
    const placed = new Map(plan.placements.map((p) => [p.attendeeId, p.seatUuid]));
    return {
      results: ids.map((id) => {
        const code = failed.get(id);
        if (code) return { id, ok: false, code };
        const seatUuid = placed.get(id);
        if (!seatUuid) return { id, ok: true };
        const c = current.get(id);
        const undo: BulkAssignUndo = {
          given: seatUuid,
          prev: c ? { seatUuid: c.seatUuid, pinned: c.pinned, priorBlock: c.priorBlock } : null,
        };
        const warn = ada && seatOf.get(seatUuid)?.accessible ? 'ada_kept_back' : undefined;
        return { id, ok: true, undo, ...(warn ? { warning: warn } : {}) };
      }),
    };
  },
  undo: async (tx, ctx, items, _params) => {
    if (items.length === 0) return;
    const orgId = requireOrg(ctx);
    const parsed = items.map((i) => ({ attendeeId: i.id, undo: UndoJson.parse(i.undo) }));
    const current = await tx
      .select({
        attendeeId: seatAssignments.attendeeId,
        seatUuid: seatAssignments.seatUuid,
        eventId: seatAssignments.eventId,
      })
      .from(seatAssignments)
      .where(
        inArray(
          seatAssignments.attendeeId,
          parsed.map((p) => p.attendeeId),
        ),
      );
    const plan = planUndo(parsed, new Map(current.map((c) => [c.attendeeId, c.seatUuid])));
    const eventOf = new Map(current.map((c) => [c.attendeeId, c.eventId]));
    await releaseAttendeeSeatsTx(tx, ctx, plan.release);
    if (plan.restore.length === 0) return;
    await tx.execute(sql`set local lock_timeout = '5s'`);
    // Back to the previous seat, if it is still what they left behind (free, or its block).
    const seats = await tx
      .select({
        seatUuid: eventSeats.seatUuid,
        eventId: eventSeats.eventId,
        itemId: eventSeats.itemId,
        status: eventSeats.status,
        blockReason: eventSeats.blockReason,
      })
      .from(eventSeats)
      .where(
        and(
          inArray(eventSeats.eventId, [...new Set(eventOf.values())]),
          inArray(
            eventSeats.seatUuid,
            plan.restore.map((r) => r.prev.seatUuid),
          ),
        ),
      )
      .orderBy(eventSeats.seatUuid)
      .for('update');
    const bySeat = new Map(seats.map((s) => [`${s.eventId}:${s.seatUuid}`, s]));
    for (const r of plan.restore) {
      const eventId = eventOf.get(r.attendeeId) as string;
      const s = bySeat.get(`${eventId}:${r.prev.seatUuid}`);
      const back =
        s &&
        (r.prev.priorBlock === null
          ? s.status === 'available'
          : s.status === 'blocked' && s.blockReason === r.prev.priorBlock);
      if (!s || !back) continue;
      await tx
        .update(eventSeats)
        .set({ status: 'blocked', blockReason: 'assigned', updatedAt: ctx.now })
        .where(and(eq(eventSeats.eventId, eventId), eq(eventSeats.seatUuid, s.seatUuid)));
      await tx.insert(seatAssignments).values({
        orgId,
        eventId,
        attendeeId: r.attendeeId,
        itemId: s.itemId,
        seatUuid: s.seatUuid,
        pinned: r.prev.pinned,
        priorBlock: r.prev.priorBlock,
      });
    }
  },
});

export const seatAssignBulk = bulkCommands(seatAssignAction);
