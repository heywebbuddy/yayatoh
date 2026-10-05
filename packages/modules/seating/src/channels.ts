import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ChannelRef,
  channelHolds,
  normalizeChannelCode,
  type SaleVia,
  saleChannel,
  sellableThrough,
} from './domain/channels.ts';
import {
  CHANNEL_KINDS,
  CODE_CHANNEL_KINDS,
  channelOrders,
  channelSeats,
  eventSeats,
  seatChannels,
} from './schema.ts';

/**
 * Sales channels and allotments (M6.11b, entitlement `advanced_seating`).
 *
 * - The organizer creates an event's channels (`public`, `box_office`, `sponsor`, `promoter`;
 *   sponsors and promoters sell through a code) and allots seats to them: whole rows or tables,
 *   or some of their seats, for every chart of the event.
 * - A seat in a channel is sold only through that channel until the channel's release time
 *   (pure rule `sellableThrough`). Holding seats (`holdSeatsTx`), taking over a best-available
 *   hold (`adoptSeatHoldTx`) and best available itself all check it; a sale that reaches a seat
 *   of another channel is refused with `seat_channel`.
 * - An order's channel is recorded (`channel_orders`): the channel's report counts it, and an
 *   order paid after its hold lapsed re-holds its seats through the same channel.
 */

/** Seats one allotment request may name (a large room). */
export const MAX_ALLOT_SEATS = 20_000;
export const MAX_CHANNELS = 50;

export const ChannelDto = z.object({
  id: z.uuid(),
  kind: z.enum(CHANNEL_KINDS),
  name: z.string(),
  code: z.string().nullable(),
  releaseAt: z.date().nullable(),
  /** The release time has come: its unsold seats are back with every channel. */
  released: z.boolean(),
  /** Seats allotted to it. */
  seats: z.int(),
  /** Paid orders sold through it, and their seats. */
  orders: z.int(),
  seatsSold: z.int(),
});
export type ChannelDto = z.infer<typeof ChannelDto>;

type ChannelRow = typeof seatChannels.$inferSelect;
const ref = (c: ChannelRow): ChannelRef & { name: string } => ({
  id: c.id,
  kind: c.kind as ChannelRef['kind'],
  code: c.code,
  releaseAt: c.releaseAt,
  name: c.name,
});

/** The event's channels, oldest first. */
export async function eventChannelsTx(tx: TenantTx, eventId: string) {
  const rows = await tx
    .select()
    .from(seatChannels)
    .where(eq(seatChannels.eventId, eventId))
    .orderBy(asc(seatChannels.createdAt));
  return rows.map(ref);
}

/**
 * The channel a sale goes through (see `saleChannel`): its id, or null for "no channel". A code
 * that names none of the event's channels is refused (`channel_code_invalid`).
 */
export async function resolveSaleChannelTx(
  tx: TenantTx,
  eventId: string,
  sale: { readonly via: SaleVia; readonly code?: string | null },
): Promise<{ id: string; kind: ChannelRef['kind']; name: string } | null> {
  const hit = saleChannel(await eventChannelsTx(tx, eventId), sale);
  if (hit === 'invalid_code')
    throw new DomainError('validation_failed', 'This sales code is not valid for this event', {
      reason: 'channel_code_invalid',
      field: 'channelCode',
    });
  return hit ? { id: hit.id, kind: hit.kind, name: hit.name } : null;
}

/**
 * Seats of the event that a sale through `channelId` (null = no channel) may not take now: those
 * allotted to another channel that still keeps them.
 */
export async function channelKeptSeatsTx(
  tx: TenantTx,
  eventId: string,
  channelId: string | null,
  now: Date,
): Promise<Set<string>> {
  const rows = await tx
    .select({ seatUuid: channelSeats.seatUuid, id: seatChannels.id, releaseAt: seatChannels.releaseAt })
    .from(channelSeats)
    .innerJoin(
      seatChannels,
      and(eq(seatChannels.orgId, channelSeats.orgId), eq(seatChannels.id, channelSeats.channelId)),
    )
    .where(eq(channelSeats.eventId, eventId));
  return new Set(rows.filter((r) => !sellableThrough(r, channelId, now)).map((r) => r.seatUuid));
}

/**
 * The SQL twin of `sellableThrough` for `event_seats` rows: the seat is in no channel that keeps
 * it from `channelId` now. Used inside the hold statement, so an allotment is checked in the same
 * statement that takes the seat.
 */
export function sellableThroughSql(channelId: string | null, now: Date) {
  return sql`not exists (
    select 1 from ${channelSeats} cs
    join ${seatChannels} c on c.org_id = cs.org_id and c.id = cs.channel_id
    where cs.org_id = ${eventSeats.orgId} and cs.event_id = ${eventSeats.eventId}
      and cs.seat_uuid = ${eventSeats.seatUuid}
      and (c.release_at is null or c.release_at > ${now.toISOString()}::timestamptz)
      and c.id is distinct from ${channelId}::uuid
  )`;
}

/** Refuse (`seat_channel`) when any of the seats is kept for another channel than `channelId`. */
export async function assertSeatChannelsTx(
  tx: TenantTx,
  ctx: Ctx,
  s: { eventId: string; seatUuids: readonly string[]; channelId: string | null },
): Promise<void> {
  if (s.seatUuids.length === 0) return;
  const kept = await channelKeptSeatsTx(tx, s.eventId, s.channelId, ctx.now);
  const hit = s.seatUuids.filter((id) => kept.has(id));
  if (hit.length)
    throw new DomainError('conflict', 'Those seats are kept for another sales channel', {
      reason: 'seat_channel',
      seats: hit,
    });
}

/** Attribute an order to the channel it was sold through (idempotent per order). */
export async function recordChannelOrderTx(
  tx: TenantTx,
  ctx: Ctx,
  o: { eventId: string; orderId: string; channelId: string | null; seats: number },
): Promise<void> {
  if (!o.channelId || o.seats < 1) return;
  await tx
    .insert(channelOrders)
    .values({
      orgId: requireOrg(ctx),
      eventId: o.eventId,
      channelId: o.channelId,
      orderId: o.orderId,
      seats: Math.min(500, o.seats),
    })
    .onConflictDoNothing();
}

/** The channel an order was sold through (null: none recorded). */
export async function orderChannelTx(tx: TenantTx, orderId: string): Promise<string | null> {
  const [row] = await tx
    .select({ channelId: channelOrders.channelId })
    .from(channelOrders)
    .where(eq(channelOrders.orderId, orderId));
  return row?.channelId ?? null;
}

// ─── The organizer's page ───────────────────────────────────────────────────────────────────

export const ChannelsPageDto = z.object({
  channels: z.array(ChannelDto),
  /** Every allotted seat and its channel. */
  allotments: z.array(z.object({ seatUuid: z.uuid(), channelId: z.uuid() })),
});
export type ChannelsPageDto = z.infer<typeof ChannelsPageDto>;

export const seatChannelsQuery = tenantQuery({
  name: 'seating.channels',
  input: z.object({ eventId: z.uuid() }),
  output: ChannelsPageDto,
  entitlement: 'advanced_seating',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const channels = await eventChannelsTx(tx, input.eventId);
    const allotments = await tx
      .select({ seatUuid: channelSeats.seatUuid, channelId: channelSeats.channelId })
      .from(channelSeats)
      .where(eq(channelSeats.eventId, input.eventId));
    const sold = await tx
      .select({
        channelId: channelOrders.channelId,
        orders: sql<number>`count(*)::int`,
        seats: sql<number>`coalesce(sum(${channelOrders.seats}), 0)::int`,
      })
      .from(channelOrders)
      .where(and(eq(channelOrders.eventId, input.eventId), isNotNull(channelOrders.soldAt)))
      .groupBy(channelOrders.channelId);
    const count = new Map<string, number>();
    for (const a of allotments) count.set(a.channelId, (count.get(a.channelId) ?? 0) + 1);
    const sales = new Map(sold.map((s) => [s.channelId, s]));
    return {
      channels: channels.map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        code: c.code,
        releaseAt: c.releaseAt,
        released: !channelHolds(c, ctx.now),
        seats: count.get(c.id) ?? 0,
        orders: sales.get(c.id)?.orders ?? 0,
        seatsSold: sales.get(c.id)?.seats ?? 0,
      })),
      allotments,
    };
  },
});

async function eventOrThrowTx(tx: TenantTx, eventId: string) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  return event;
}

/** Create or change a channel. Sponsors and promoters need a code; the others have none. */
export const saveSeatChannelCommand = tenantCommand({
  name: 'seating.saveChannel',
  input: z.object({
    eventId: z.uuid(),
    id: z.uuid().optional(),
    kind: z.enum(CHANNEL_KINDS),
    name: z.string().trim().min(1).max(80),
    code: z.string().trim().max(40).nullable().optional(),
    releaseAt: z.coerce.date().nullable().optional(),
  }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'advanced_seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOrThrowTx(tx, input.eventId);
    const needsCode = (CODE_CHANNEL_KINDS as readonly string[]).includes(input.kind);
    const typed = input.code?.trim() ? input.code : null;
    if (needsCode && !typed)
      throw new DomainError('validation_failed', 'Give this channel a code', {
        reason: 'code_required',
        field: 'code',
      });
    if (!needsCode && typed)
      throw new DomainError('validation_failed', 'Only sponsor and promoter channels have a code', {
        reason: 'code_not_allowed',
        field: 'code',
      });
    const code = typed ? normalizeChannelCode(typed) : null;
    if (typed && !code)
      throw new DomainError('validation_failed', 'Codes are 3 to 32 letters, digits, dashes or underscores', {
        reason: 'code_format',
        field: 'code',
      });
    const others = (await eventChannelsTx(tx, input.eventId)).filter((c) => c.id !== input.id);
    if (!input.id && others.length >= MAX_CHANNELS)
      throw new DomainError('validation_failed', 'Too many channels', { reason: 'too_many_channels' });
    if (code && others.some((c) => c.code === code))
      throw new DomainError('conflict', 'Another channel of this event has that code', {
        reason: 'code_taken',
        field: 'code',
      });
    if ((input.kind === 'public' || input.kind === 'box_office') && others.some((c) => c.kind === input.kind))
      throw new DomainError('conflict', 'This event already has that channel', {
        reason: 'kind_taken',
        field: 'kind',
      });
    const values = {
      kind: input.kind,
      name: input.name,
      code,
      releaseAt: input.releaseAt ?? null,
      updatedAt: ctx.now,
    };
    const [row] = input.id
      ? await tx
          .update(seatChannels)
          .set(values)
          .where(and(eq(seatChannels.id, input.id), eq(seatChannels.eventId, input.eventId)))
          .returning({ id: seatChannels.id })
      : await tx
          .insert(seatChannels)
          .values({ orgId: requireOrg(ctx), eventId: input.eventId, ...values })
          .returning({ id: seatChannels.id });
    if (!row) throw new DomainError('not_found', 'Channel not found');
    return { id: row.id };
  },
  audit: (input, r) => ({
    action: input.id ? 'seating.channel_update' : 'seating.channel_create',
    targetType: 'event',
    targetId: input.eventId,
    data: { channelId: r?.id ?? input.id ?? null, kind: input.kind },
  }),
});

/** Remove a channel: its seats go back to every channel (orders keep their seats). */
export const deleteSeatChannelCommand = tenantCommand({
  name: 'seating.deleteChannel',
  // Its allotment and its sales report go with it (M1.2e: refused while impersonating).
  category: 'delete',
  input: z.object({ eventId: z.uuid(), id: z.uuid() }),
  output: z.object({ released: z.int() }),
  entitlement: 'advanced_seating',
  permission: 'seating:write',
  handler: async ({ input, tx }) => {
    const freed = await tx
      .delete(channelSeats)
      .where(and(eq(channelSeats.channelId, input.id), eq(channelSeats.eventId, input.eventId)))
      .returning({ id: channelSeats.id });
    const [row] = await tx
      .delete(seatChannels)
      .where(and(eq(seatChannels.id, input.id), eq(seatChannels.eventId, input.eventId)))
      .returning({ id: seatChannels.id });
    if (!row) throw new DomainError('not_found', 'Channel not found');
    return { released: freed.length };
  },
  audit: (input, r) => ({
    action: 'seating.channel_delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { channelId: input.id, released: r?.released },
  }),
});

/**
 * Allot seats to a channel, or give them back to every channel (`channelId: null`): whole rows or
 * tables (`itemIds`), sections, or single seats. A seat in another channel moves to this one.
 * Seats are named once for the event: every chart of it follows.
 */
export const allotSeatsCommand = tenantCommand({
  name: 'seating.allotSeats',
  input: z.object({
    eventId: z.uuid(),
    channelId: z.uuid().nullable(),
    sectionIds: z.array(z.uuid()).max(200).default([]),
    itemIds: z.array(z.uuid()).max(5000).default([]),
    seatUuids: z.array(z.uuid()).max(MAX_ALLOT_SEATS).default([]),
  }),
  output: z.object({ updated: z.int() }),
  entitlement: 'advanced_seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (!input.sectionIds.length && !input.itemIds.length && !input.seatUuids.length)
      throw new DomainError('validation_failed', 'Choose the seats', { reason: 'no_seats', field: 'seats' });
    if (input.channelId) {
      const [channel] = await tx
        .select({ id: seatChannels.id })
        .from(seatChannels)
        .where(and(eq(seatChannels.id, input.channelId), eq(seatChannels.eventId, input.eventId)));
      if (!channel) throw new DomainError('not_found', 'Channel not found', { field: 'channelId' });
    }
    // The seats the event's charts know (seat ids repeat across charts: one allotment each).
    const rows = await tx
      .selectDistinct({ seatUuid: eventSeats.seatUuid })
      .from(eventSeats)
      .where(
        and(
          eq(eventSeats.eventId, input.eventId),
          or(
            input.sectionIds.length ? inArray(eventSeats.sectionId, input.sectionIds) : sql`false`,
            input.itemIds.length ? inArray(eventSeats.itemId, input.itemIds) : sql`false`,
            input.seatUuids.length ? inArray(eventSeats.seatUuid, input.seatUuids) : sql`false`,
          ),
        ),
      );
    const ids = rows.map((r) => r.seatUuid);
    if (ids.length === 0) return { updated: 0 };
    if (!input.channelId) {
      const gone = await tx
        .delete(channelSeats)
        .where(and(eq(channelSeats.eventId, input.eventId), inArray(channelSeats.seatUuid, ids)))
        .returning({ id: channelSeats.id });
      return { updated: gone.length };
    }
    let updated = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const done = await tx
        .insert(channelSeats)
        .values(
          ids.slice(i, i + 1000).map((seatUuid) => ({
            orgId,
            eventId: input.eventId,
            channelId: input.channelId as string,
            seatUuid,
          })),
        )
        .onConflictDoUpdate({
          target: [channelSeats.orgId, channelSeats.eventId, channelSeats.seatUuid],
          set: { channelId: input.channelId, updatedAt: ctx.now },
        })
        .returning({ id: channelSeats.id });
      updated += done.length;
    }
    return { updated };
  },
  audit: (input, r) => ({
    action: input.channelId ? 'seating.allot' : 'seating.unallot',
    targetType: 'event',
    targetId: input.eventId,
    data: { channelId: input.channelId, updated: r?.updated },
  }),
});
