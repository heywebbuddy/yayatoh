import { attendeesByIdsTx, eventAttendeesTx } from '@yayatoh/attendees';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ASSIGN_SEAT_STATES, assignSeatState, pickSeats } from './domain/assign.ts';
import { activeAdaRule } from './domain/rules.ts';
import type { SeatStatus } from './domain/seat-state.ts';
import { checkSeatRulesTx, RuleHitDto, seatingRulesTx } from './rules.ts';
import {
  ASSIGNABLE_BLOCKS,
  EVENT_LAYOUT_STATUSES,
  eventLayouts,
  eventSeats,
  seatAssignments,
} from './schema.ts';

/** At most this many people are seated in one go (a party, a family, a table of colleagues). */
export const MAX_ASSIGN = 50;

type Assignable = (typeof ASSIGNABLE_BLOCKS)[number];
const isAssignableBlock = (r: string | null): r is Assignable =>
  (ASSIGNABLE_BLOCKS as readonly string[]).includes(r ?? '');

async function layoutDocTx(tx: TenantTx, eventId: string) {
  const [row] = await tx
    .select({ doc: eventLayouts.doc, status: eventLayouts.status })
    .from(eventLayouts)
    .where(eq(eventLayouts.eventId, eventId));
  return row ? { doc: FloorplanDoc.parse(row.doc), status: row.status } : null;
}

/**
 * Unseat attendees: their assignments go, and each seat returns to what it was before (free, or
 * its channel/accessibility block) — the `seat_assignments` delete trigger does that, so an
 * assignment removed any other way (an attendee record deleted by an import undo) frees its
 * seat too. Refunds and voids call this in their own transaction; a guest taken off the list
 * reaches it through `attendee.cancelled`.
 */
export async function releaseAttendeeSeatsTx(
  tx: TenantTx,
  _ctx: Ctx,
  attendeeIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(attendeeIds)];
  if (ids.length === 0) return 0;
  const gone = await tx
    .delete(seatAssignments)
    .where(inArray(seatAssignments.attendeeId, ids))
    .returning({ id: seatAssignments.id });
  return gone.length;
}

/**
 * The floor plan changed: assignments whose seat no longer exists are dropped, and the rest
 * follow their seat's table or row (seats keep their ids across edits).
 */
export async function reconcileAssignmentsTx(tx: TenantTx, eventId: string): Promise<void> {
  await tx.execute(sql`
    delete from ${seatAssignments} a
    where a.event_id = ${eventId}
      and not exists (
        select 1 from ${eventSeats} s where s.event_id = a.event_id and s.seat_uuid = a.seat_uuid
      )`);
  await tx.execute(sql`
    update ${seatAssignments} a set item_id = s.item_id
    from ${eventSeats} s
    where a.event_id = ${eventId} and s.event_id = a.event_id and s.seat_uuid = a.seat_uuid
      and a.item_id <> s.item_id`);
}

const AssignedDto = z.object({ attendeeId: z.uuid(), seatUuid: z.uuid(), seatLabel: z.string() });

/**
 * Seat people at a table or row (M1.7d). Without `seatUuid` they take the first free seats there
 * (accessible seats last); with it, one person takes that exact seat, even one blocked for a
 * channel or accessibility, and a guest who was placed there automatically moves to another
 * free seat at the same table. Anyone already seated elsewhere moves ("Move to…", M1.7f). Seats
 * taken this way are blocked (`assigned`), so they are off sale; held, sold and killed seats
 * can't be assigned, and ticket holders who chose a seat when buying are already seated by their
 * ticket. Seating rules (M1.7f): while accessible seats are kept back, a guest placed in one is
 * a warning; when the rule is enforced, automatic placement skips them and choosing one needs
 * `overrideRules` ("this guest needs an accessible seat", audited).
 */
export const assignSeatsCommand = tenantCommand({
  name: 'seating.assign',
  input: z
    .object({
      eventId: z.uuid(),
      attendeeIds: z.array(z.uuid()).min(1).max(MAX_ASSIGN),
      itemId: z.uuid(),
      seatUuid: z.uuid().optional(),
      overrideRules: z.boolean().default(false),
    })
    .refine((v) => !v.seatUuid || new Set(v.attendeeIds).size === 1, {
      message: 'A seat is for one person',
      path: ['seatUuid'],
    }),
  output: z.object({ itemLabel: z.string(), seated: z.array(AssignedDto), warnings: z.array(RuleHitDto) }),
  entitlement: 'seating',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const ids = [...new Set(input.attendeeIds)];
    const layout = await layoutDocTx(tx, input.eventId);
    if (!layout) throw new DomainError('not_found', 'This event has no floor plan');
    const item = layout.doc.items.find((i) => i.id === input.itemId);
    if (!item || item.kind === 'object')
      throw new DomainError('not_found', 'No such table or row', { field: 'itemId' });

    // Who: active attendees of this event, not already seated by a ticket they bought.
    const people = await attendeesByIdsTx(tx, ids);
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const id of ids) {
      const p = byId.get(id);
      if (!p || p.eventId !== input.eventId)
        throw new DomainError('not_found', 'Attendee not found', { field: 'attendeeIds' });
      if (p.status !== 'active')
        throw new DomainError('invalid_state', 'This person is no longer attending', {
          reason: 'attendee_cancelled',
        });
    }
    const ticketIds = people.flatMap((p) => (p.ticketId ? [p.ticketId] : []));
    if (ticketIds.length) {
      const [bought] = await tx
        .select({ id: eventSeats.id })
        .from(eventSeats)
        .where(
          and(
            eq(eventSeats.eventId, input.eventId),
            eq(eventSeats.status, 'sold'),
            inArray(eventSeats.ticketId, ticketIds),
          ),
        )
        .limit(1);
      if (bought)
        throw new DomainError('invalid_state', 'Already seated by their ticket', {
          reason: 'seated_by_ticket',
        });
    }

    // Lock the table's seats: concurrent assignments to one table queue up here.
    await tx.execute(sql`set local lock_timeout = '2s'`);
    const seatRows = await tx
      .select({
        seatUuid: eventSeats.seatUuid,
        label: eventSeats.label,
        status: eventSeats.status,
        blockReason: eventSeats.blockReason,
        accessible: eventSeats.accessible,
      })
      .from(eventSeats)
      .where(and(eq(eventSeats.eventId, input.eventId), eq(eventSeats.itemId, item.id)))
      .for('update');
    const seatOf = new Map(seatRows.map((s) => [s.seatUuid, s]));
    const current = await tx
      .select({
        id: seatAssignments.id,
        attendeeId: seatAssignments.attendeeId,
        itemId: seatAssignments.itemId,
        seatUuid: seatAssignments.seatUuid,
        pinned: seatAssignments.pinned,
      })
      .from(seatAssignments)
      .where(eq(seatAssignments.eventId, input.eventId));
    const mine = new Map(current.filter((c) => ids.includes(c.attendeeId)).map((c) => [c.attendeeId, c]));

    // Already where they're asked to be: nothing to do for them.
    const moving = ids.filter((id) => {
      const c = mine.get(id);
      if (!c) return true;
      return input.seatUuid ? c.seatUuid !== input.seatUuid : c.itemId !== item.id;
    });
    // Moving people leave their seats first (same transaction: a refusal below undoes this).
    await releaseAttendeeSeatsTx(
      tx,
      ctx,
      moving.filter((id) => mine.has(id)),
    );
    const freed = new Set(moving.flatMap((id) => mine.get(id)?.seatUuid ?? []));
    const stateOf = (s: { seatUuid: string; status: string; blockReason: string | null }) =>
      freed.has(s.seatUuid) ? 'free' : assignSeatState(s.status as SeatStatus, s.blockReason);
    // An enforced accessibility rule keeps accessible seats out of automatic placement.
    const rules = await seatingRulesTx(tx, input.eventId);
    const event = rules.length ? await findEventTx(tx, input.eventId) : null;
    const ada = event ? activeAdaRule(rules, event.startsAt, ctx.now) : null;
    const skipAccessible = ada?.severity === 'enforce' && !input.overrideRules;
    const autoFree = (s: {
      seatUuid: string;
      status: string;
      blockReason: string | null;
      accessible: boolean;
    }) => stateOf(s) === 'free' && !(skipAccessible && s.accessible);

    const wanted: { attendeeId: string; seatUuid: string; pinned: boolean }[] = [];
    if (input.seatUuid && moving.length) {
      const seat = seatOf.get(input.seatUuid);
      if (!seat) throw new DomainError('not_found', 'No such seat at this table', { field: 'seatUuid' });
      const state = stateOf(seat);
      if (state === 'assigned') {
        // Someone placed there automatically makes room by moving to another free seat here.
        const holder = current.find((c) => c.seatUuid === seat.seatUuid);
        const other = pickSeats(
          seatRows.map((s) => ({ ...s, free: autoFree(s) && s.seatUuid !== seat.seatUuid })),
          1,
        ).seats?.[0];
        if (!holder || holder.pinned || !other)
          throw new DomainError('conflict', 'Someone already sits there', { reason: 'seat_taken' });
        await releaseAttendeeSeatsTx(tx, ctx, [holder.attendeeId]);
        wanted.push({ attendeeId: holder.attendeeId, seatUuid: other, pinned: false });
      } else if (state !== 'free' && state !== 'reserved')
        throw new DomainError('conflict', 'That seat is not free', {
          reason: state === 'blocked' ? 'seat_blocked' : 'seat_taken',
        });
      wanted.push({ attendeeId: moving[0] as string, seatUuid: seat.seatUuid, pinned: true });
    } else if (moving.length) {
      const picked = pickSeats(
        seatRows.map((s) => ({ ...s, free: autoFree(s) })),
        moving.length,
      );
      if (!picked.seats)
        throw new DomainError('conflict', `Only ${picked.fits} more fit at this table`, {
          reason: 'not_enough_seats',
          fits: picked.fits,
          asked: moving.length,
        });
      for (const [i, seatUuid] of picked.seats.entries())
        wanted.push({ attendeeId: moving[i] as string, seatUuid, pinned: false });
    }

    // Seating rules (M1.7f): enforced ones refuse unless overridden; warnings go back to the caller.
    const warnings = await checkSeatRulesTx(tx, ctx, {
      eventId: input.eventId,
      seatUuids: wanted.map((w) => w.seatUuid),
      context: 'assign',
      override: input.overrideRules,
    });
    if (wanted.length) {
      // What each seat was before (a channel or accessibility block comes back on unseating).
      const before = await tx
        .select({
          seatUuid: eventSeats.seatUuid,
          status: eventSeats.status,
          blockReason: eventSeats.blockReason,
        })
        .from(eventSeats)
        .where(
          and(
            eq(eventSeats.eventId, input.eventId),
            inArray(
              eventSeats.seatUuid,
              wanted.map((w) => w.seatUuid),
            ),
          ),
        );
      const prior = new Map(
        before.map((b) => [
          b.seatUuid,
          b.status === 'blocked' && isAssignableBlock(b.blockReason) ? b.blockReason : null,
        ]),
      );
      // One statement, like a hold: seats a buyer took meanwhile make the whole thing fail.
      const taken = await tx
        .update(eventSeats)
        .set({ status: 'blocked', blockReason: 'assigned', updatedAt: ctx.now })
        .where(
          and(
            eq(eventSeats.eventId, input.eventId),
            inArray(
              eventSeats.seatUuid,
              wanted.map((w) => w.seatUuid),
            ),
            sql`(${eventSeats.status} = 'available' or (${eventSeats.status} = 'blocked' and ${eventSeats.blockReason} in ('channel', 'ada')))`,
          ),
        )
        .returning({ seatUuid: eventSeats.seatUuid });
      if (taken.length !== wanted.length)
        throw new DomainError('conflict', 'Some of those seats were just taken', { reason: 'seats_taken' });
      await tx.insert(seatAssignments).values(
        wanted.map((w) => ({
          orgId,
          eventId: input.eventId,
          attendeeId: w.attendeeId,
          itemId: item.id,
          seatUuid: w.seatUuid,
          pinned: w.pinned,
          priorBlock: prior.get(w.seatUuid) ?? null,
        })),
      );
    }
    const labelOf = new Map(seatRows.map((s) => [s.seatUuid, s.label]));
    const finalSeat = new Map([
      ...ids.flatMap((id) => {
        const c = mine.get(id);
        return c && !moving.includes(id) ? [[id, c.seatUuid] as const] : [];
      }),
      ...wanted.map((w) => [w.attendeeId, w.seatUuid] as const),
    ]);
    return {
      itemLabel: item.label,
      seated: ids.map((id) => {
        const seatUuid = finalSeat.get(id) as string;
        return { attendeeId: id, seatUuid, seatLabel: labelOf.get(seatUuid) ?? '' };
      }),
      warnings,
    };
  },
  audit: (input, r) => ({
    action: 'seating.assign',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      itemId: input.itemId,
      seatUuid: input.seatUuid,
      count: r?.seated.length,
      ...(input.overrideRules ? { overrideRules: true } : {}),
      ...(r?.warnings.length ? { warnings: r.warnings.map((w) => w.rule) } : {}),
    },
  }),
});

/** Take people off their seats; the seats go back to what they were. */
export const unassignSeatsCommand = tenantCommand({
  name: 'seating.unassign',
  input: z.object({ eventId: z.uuid(), attendeeIds: z.array(z.uuid()).min(1).max(500) }),
  output: z.object({ released: z.int() }),
  entitlement: 'seating',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .select({ attendeeId: seatAssignments.attendeeId })
      .from(seatAssignments)
      .where(
        and(
          eq(seatAssignments.eventId, input.eventId),
          inArray(seatAssignments.attendeeId, input.attendeeIds),
        ),
      );
    return {
      released: await releaseAttendeeSeatsTx(
        tx,
        ctx,
        rows.map((r) => r.attendeeId),
      ),
    };
  },
  audit: (input, r) => ({
    action: 'seating.unassign',
    targetType: 'event',
    targetId: input.eventId,
    data: { count: r?.released },
  }),
});

const PersonDto = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  labels: z.array(z.string()),
});

export const SeatAssignmentsDto = z.object({
  status: z.enum(EVENT_LAYOUT_STATUSES),
  items: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['row', 'table']),
      label: z.string(),
      capacity: z.int(),
      /** Seats anyone can still be placed in automatically. */
      free: z.int(),
      seats: z.array(
        z.object({
          seatUuid: z.uuid(),
          label: z.string(),
          state: z.enum(ASSIGN_SEAT_STATES),
          accessible: z.boolean(),
          /** Who sits here: a guest the organizer seated, or the buyer of the seat's ticket. */
          person: z
            .object({
              attendeeId: z.uuid(),
              name: z.string(),
              byTicket: z.boolean(),
              pinned: z.boolean(),
            })
            .nullable(),
        }),
      ),
    }),
  ),
  /** Active attendees with no seat yet (the unseated queue), by name. */
  unseated: z.array(PersonDto),
  seatedCount: z.int(),
});
export type SeatAssignmentsDto = z.infer<typeof SeatAssignmentsDto>;

/**
 * The organizer's assignment view: every table and row with its seats and who sits in them, and
 * the unseated queue. Names and emails of the event's people: `attendees:read`.
 */
export const seatAssignmentsQuery = tenantQuery({
  name: 'seating.assignments',
  input: z.object({ eventId: z.uuid() }),
  output: SeatAssignmentsDto.nullable(),
  entitlement: 'seating',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const layout = await layoutDocTx(tx, input.eventId);
    if (!layout) return null;
    const [seats, assigned, people] = await Promise.all([
      tx
        .select({
          seatUuid: eventSeats.seatUuid,
          label: eventSeats.label,
          status: eventSeats.status,
          blockReason: eventSeats.blockReason,
          ticketId: eventSeats.ticketId,
          accessible: eventSeats.accessible,
        })
        .from(eventSeats)
        .where(eq(eventSeats.eventId, input.eventId)),
      tx
        .select({
          attendeeId: seatAssignments.attendeeId,
          seatUuid: seatAssignments.seatUuid,
          pinned: seatAssignments.pinned,
        })
        .from(seatAssignments)
        .where(eq(seatAssignments.eventId, input.eventId)),
      eventAttendeesTx(tx, input.eventId),
    ]);
    const person = new Map(people.map((p) => [p.id, p]));
    const byTicket = new Map(people.flatMap((p) => (p.ticketId ? [[p.ticketId, p] as const] : [])));
    const bySeat = new Map(seats.map((s) => [s.seatUuid, s]));
    const assignedAt = new Map(assigned.map((a) => [a.seatUuid, a]));
    const seated = new Set<string>();
    const items = layout.doc.items.flatMap((item) => {
      if (item.kind === 'object') return [];
      const rows = item.seats.flatMap((d) => {
        const s = bySeat.get(d.id);
        if (!s) return [];
        const state = assignSeatState(s.status as SeatStatus, s.blockReason);
        const a = state === 'assigned' ? assignedAt.get(s.seatUuid) : undefined;
        const who = a ? person.get(a.attendeeId) : s.ticketId ? byTicket.get(s.ticketId) : undefined;
        if (who && (a || state === 'sold')) seated.add(who.id);
        return [
          {
            seatUuid: s.seatUuid,
            label: s.label,
            state,
            accessible: s.accessible,
            person:
              who && (a || state === 'sold')
                ? { attendeeId: who.id, name: who.name, byTicket: !a, pinned: a?.pinned ?? false }
                : null,
          },
        ];
      });
      return [
        {
          id: item.id,
          kind: item.kind,
          label: item.label,
          capacity: rows.length,
          free: rows.filter((r) => r.state === 'free').length,
          seats: rows,
        },
      ];
    });
    return SeatAssignmentsDto.parse({
      status: layout.status as (typeof EVENT_LAYOUT_STATUSES)[number],
      items,
      unseated: people
        .filter((p) => !seated.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, email: p.email, labels: p.labels })),
      seatedCount: seated.size,
    });
  },
});

const CancelledPayload = z.object({ orgId: z.uuid(), eventId: z.uuid(), attendeeId: z.uuid() });

/** A guest taken off the list gives their seat back (worker). */
export function releaseCancelledSeats() {
  return defineSubscriber({
    name: 'seating.release-cancelled',
    events: ['attendee.cancelled@1'],
    handle: async (tx, event) => {
      const p = CancelledPayload.parse(event.payload);
      const ctx = createCtx({ orgId: p.orgId, actor: { type: 'system', name: 'seating.release-cancelled' } });
      await releaseAttendeeSeatsTx(tx, ctx, [p.attendeeId]);
    },
  });
}
