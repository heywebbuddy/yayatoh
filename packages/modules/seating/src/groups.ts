import { AttendeeLabel } from '@yayatoh/attendees';
import type { TenantTx } from '@yayatoh/db';
import { FloorplanDoc } from '@yayatoh/floorplan';
import { DomainError } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ChartKey, chartKeyTx, onChart } from './chart.ts';
import { pickSeats } from './domain/assign.ts';
import { activeAdaRule } from './domain/rules.ts';
import { ruleStartTx, seatingRulesTx } from './rules.ts';
import { eventLayouts, eventSeats } from './schema.ts';

/** At most this many seats go to a group in one allocation (a whole room of tables). */
export const MAX_GROUP_SEATS = 2_000;

async function planItemsTx(tx: TenantTx, eventId: string, key: ChartKey) {
  const [row] = await tx
    .select({ doc: eventLayouts.doc })
    .from(eventLayouts)
    .where(onChart(eventLayouts, eventId, key));
  if (!row) throw new DomainError('not_found', 'This event has no floor plan');
  return FloorplanDoc.parse(row.doc).items;
}

/**
 * Keep a block of seats for a group (M1.8f): a group is an attendee label (a company, a family).
 * The next free seats of a table or row, in plan order (accessible seats last, and never while
 * an enforced keep-back rule applies), are blocked for the group under its name — off sale until
 * released. `count` omitted = every free seat there. Fewer free seats than asked: nothing
 * changes (`not_enough_seats`, with how many fit).
 */
export const allocateGroupSeatsCommand = tenantCommand({
  name: 'seating.allocateGroup',
  input: z.object({
    eventId: z.uuid(),
    /** The date (M1.7g): the chart it uses. */
    occurrenceId: z.uuid().nullable().optional(),
    label: AttendeeLabel,
    itemId: z.uuid(),
    count: z.int().min(1).max(MAX_GROUP_SEATS).optional(),
  }),
  output: z.object({ label: z.string(), itemLabel: z.string(), allocated: z.int() }),
  entitlement: 'seating',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const items = await planItemsTx(tx, input.eventId, key);
    const item = items.find((i) => i.id === input.itemId);
    if (!item || item.kind === 'object')
      throw new DomainError('not_found', 'No such table or row', { field: 'itemId' });
    await tx.execute(sql`set local lock_timeout = '2s'`);
    const planOrder = new Map(item.seats.map((d, i) => [d.id, i]));
    const rows = (
      await tx
        .select({
          seatUuid: eventSeats.seatUuid,
          status: eventSeats.status,
          accessible: eventSeats.accessible,
        })
        .from(eventSeats)
        .where(and(onChart(eventSeats, input.eventId, key), eq(eventSeats.itemId, item.id)))
        .orderBy(eventSeats.seatUuid)
        .for('update')
    ).sort((x, y) => (planOrder.get(x.seatUuid) ?? 0) - (planOrder.get(y.seatUuid) ?? 0));
    const rules = await seatingRulesTx(tx, input.eventId);
    const startsAt = rules.length ? await ruleStartTx(tx, input.eventId, input.occurrenceId) : null;
    const ada = startsAt ? activeAdaRule(rules, startsAt, ctx.now) : null;
    const skipAccessible = ada?.severity === 'enforce';
    const candidates = rows.map((r) => ({
      seatUuid: r.seatUuid,
      accessible: r.accessible,
      free: r.status === 'available' && !(skipAccessible && r.accessible),
    }));
    const fits = candidates.filter((c) => c.free).length;
    const want = input.count ?? fits;
    const picked = pickSeats(candidates, want);
    if (want === 0 || !picked.seats)
      throw new DomainError('conflict', `Only ${fits} free seats there`, {
        reason: 'not_enough_seats',
        fits,
        asked: want,
      });
    const taken = await tx
      .update(eventSeats)
      .set({ status: 'blocked', blockReason: 'group', groupLabel: input.label, updatedAt: ctx.now })
      .where(
        and(
          onChart(eventSeats, input.eventId, key),
          eq(eventSeats.status, 'available'),
          inArray(eventSeats.seatUuid, picked.seats),
        ),
      )
      .returning({ id: eventSeats.id });
    if (taken.length !== picked.seats.length)
      throw new DomainError('conflict', 'Some of those seats were just taken', { reason: 'seats_taken' });
    return { label: input.label, itemLabel: item.label, allocated: taken.length };
  },
  audit: (input, r) => ({
    action: 'seating.group_allocate',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      label: input.label,
      itemId: input.itemId,
      allocated: r?.allocated,
      occurrenceId: input.occurrenceId ?? null,
    },
  }),
});

/** Give a group's unused seats back to sale. Seats its members sit in stay theirs. */
export const releaseGroupSeatsCommand = tenantCommand({
  name: 'seating.releaseGroup',
  input: z.object({ eventId: z.uuid(), occurrenceId: z.uuid().nullable().optional(), label: AttendeeLabel }),
  output: z.object({ released: z.int() }),
  entitlement: 'seating',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const rows = await tx
      .update(eventSeats)
      .set({ status: 'available', blockReason: null, groupLabel: null, updatedAt: ctx.now })
      .where(
        and(
          onChart(eventSeats, input.eventId, key),
          eq(eventSeats.status, 'blocked'),
          eq(eventSeats.blockReason, 'group'),
          eq(eventSeats.groupLabel, input.label),
        ),
      )
      .returning({ id: eventSeats.id });
    if (rows.length === 0) throw new DomainError('not_found', 'This group has no unused seats');
    return { released: rows.length };
  },
  audit: (input, r) => ({
    action: 'seating.group_release',
    targetType: 'event',
    targetId: input.eventId,
    data: { label: input.label, released: r?.released, occurrenceId: input.occurrenceId ?? null },
  }),
});

export const SeatGroupDto = z.object({
  label: z.string(),
  /** Seats kept for the group, used or not. */
  seats: z.int(),
  /** Seats its members sit in. */
  seated: z.int(),
  /** Seats still waiting for a member (released by "release unused seats"). */
  unused: z.int(),
  /** The tables and rows its seats are at, in plan order. */
  items: z.array(z.object({ kind: z.enum(['row', 'table']), label: z.string() })),
});
export type SeatGroupDto = z.infer<typeof SeatGroupDto>;

/** An event's groups and their seat blocks (organizer console). */
export const seatGroupsQuery = tenantQuery({
  name: 'seating.groups',
  input: z.object({ eventId: z.uuid(), occurrenceId: z.uuid().nullable().optional() }),
  output: z.array(SeatGroupDto),
  entitlement: 'seating',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const key = await chartKeyTx(tx, input.eventId, input.occurrenceId);
    const rows = await tx
      .select({
        label: eventSeats.groupLabel,
        itemId: eventSeats.itemId,
        status: eventSeats.status,
        blockReason: eventSeats.blockReason,
      })
      .from(eventSeats)
      .where(and(onChart(eventSeats, input.eventId, key), isNotNull(eventSeats.groupLabel)));
    if (rows.length === 0) return [];
    const items = await planItemsTx(tx, input.eventId, key);
    const order = new Map(items.map((i, n) => [i.id, n]));
    const itemOf = new Map(
      items.flatMap((i) => (i.kind === 'object' ? [] : [[i.id, { kind: i.kind, label: i.label }] as const])),
    );
    const groups = new Map<string, { seats: number; seated: number; unused: number; items: Set<string> }>();
    for (const r of rows) {
      const label = r.label as string;
      const g = groups.get(label) ?? { seats: 0, seated: 0, unused: 0, items: new Set<string>() };
      const unused = r.status === 'blocked' && r.blockReason === 'group';
      const seated = r.status === 'blocked' && r.blockReason === 'assigned';
      if (!unused && !seated) continue;
      g.seats++;
      if (unused) g.unused++;
      else g.seated++;
      g.items.add(r.itemId);
      groups.set(label, g);
    }
    return [...groups]
      .map(([label, g]) => ({
        label,
        seats: g.seats,
        seated: g.seated,
        unused: g.unused,
        items: [...g.items]
          .sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0))
          .flatMap((id) => itemOf.get(id) ?? []),
      }))
      .sort((x, y) => x.label.localeCompare(y.label));
  },
});
