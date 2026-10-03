import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { channelKeptSeatsTx, sellableThroughSql } from './channels.ts';
import { chartKeyTx, onChart } from './chart.ts';
import { channelOrders, eventLayouts, eventSeats } from './schema.ts';

/**
 * Hold seats for a checkout (ADR 0012): one statement moves every requested seat from
 * `available` to `held` under a short lock timeout. If fewer rows move than were asked for, the
 * seats are taken and the caller's transaction must roll back (`conflict`, reason `seats_taken`).
 * M6.11b: the hold goes through one sales channel (`channelId`; omitted or null = no channel); a
 * seat another channel keeps is never taken (`conflict`, reason `seat_channel`).
 */
export async function holdSeatsTx(
  tx: TenantTx,
  ctx: Ctx,
  h: {
    eventId: string;
    /** The order's date (M1.7g): the seats are on that date's chart. */
    occurrenceId?: string | null;
    seatUuids: readonly string[];
    holdId: string;
    expiresAt: Date;
    /** The sales channel (M6.11b, `resolveSaleChannelTx`); omitted or null = no channel. */
    channelId?: string | null;
  },
): Promise<{ seatUuid: string; ticketTypeId: string | null; label: string }[]> {
  const ids = [...new Set(h.seatUuids)];
  if (ids.length === 0) return [];
  const key = await chartKeyTx(tx, h.eventId, h.occurrenceId);
  const [layout] = await tx
    .select({ status: eventLayouts.status })
    .from(eventLayouts)
    .where(onChart(eventLayouts, h.eventId, key));
  if (!layout || layout.status === 'draft')
    throw new DomainError('invalid_state', 'Seats are not on sale', { reason: 'seats_not_on_sale' });
  await tx.execute(sql`set local lock_timeout = '2s'`);
  const rows = await tx
    .update(eventSeats)
    .set({
      status: 'held',
      holdId: h.holdId,
      holdExpiresAt: h.expiresAt,
      // On the event plan of a multi-date event, the seat is taken for this date (M1.7g).
      heldForOccurrenceId: key === null ? (h.occurrenceId ?? null) : null,
      updatedAt: ctx.now,
    })
    .where(
      and(
        onChart(eventSeats, h.eventId, key),
        inArray(eventSeats.seatUuid, ids),
        eq(eventSeats.status, 'available'),
        sellableThroughSql(h.channelId ?? null, ctx.now),
      ),
    )
    .returning({
      seatUuid: eventSeats.seatUuid,
      ticketTypeId: eventSeats.ticketTypeId,
      label: eventSeats.label,
    });
  if (rows.length !== ids.length) {
    const kept = await channelKeptSeatsTx(tx, h.eventId, h.channelId ?? null, ctx.now);
    const hit = ids.filter((id) => kept.has(id));
    if (hit.length)
      throw new DomainError('conflict', 'Those seats are kept for another sales channel', {
        reason: 'seat_channel',
        seats: hit,
      });
    throw new DomainError('conflict', 'Some of those seats were just taken', { reason: 'seats_taken' });
  }
  return rows;
}

/** The hold became a sale: seats are sold to their tickets, and the event's layout locks. */
export async function sellSeatsTx(
  tx: TenantTx,
  ctx: Ctx,
  s: {
    eventId: string;
    occurrenceId?: string | null;
    holdId: string;
    tickets: readonly { seatUuid: string; ticketId: string }[];
  },
): Promise<void> {
  const key = await chartKeyTx(tx, s.eventId, s.occurrenceId);
  for (const t of s.tickets) {
    const rows = await tx
      .update(eventSeats)
      .set({ status: 'sold', ticketId: t.ticketId, holdId: null, holdExpiresAt: null, updatedAt: ctx.now })
      .where(
        and(
          onChart(eventSeats, s.eventId, key),
          eq(eventSeats.seatUuid, t.seatUuid),
          eq(eventSeats.holdId, s.holdId),
        ),
      )
      .returning({ id: eventSeats.id });
    if (rows.length !== 1)
      throw new DomainError('conflict', 'The seat hold was lost', { reason: 'hold_lost' });
  }
  // M6.11b: the order's channel (when it went through one) counts the sale.
  await tx
    .update(channelOrders)
    .set({ soldAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(channelOrders.orderId, s.holdId), isNull(channelOrders.soldAt)));
  await tx
    .update(eventLayouts)
    .set({ status: 'locked', lockedAt: ctx.now, updatedAt: ctx.now })
    .where(and(onChart(eventLayouts, s.eventId, key), eq(eventLayouts.status, 'published')));
}

/** Give a hold's seats back (checkout expired or abandoned). */
export async function releaseSeatHoldTx(tx: TenantTx, ctx: Ctx, holdId: string): Promise<number> {
  const rows = await tx
    .update(eventSeats)
    .set({
      status: 'available',
      holdId: null,
      holdExpiresAt: null,
      heldForOccurrenceId: null,
      updatedAt: ctx.now,
    })
    .where(and(eq(eventSeats.holdId, holdId), eq(eventSeats.status, 'held')))
    .returning({ id: eventSeats.id });
  return rows.length;
}

/** A seated ticket was voided (refund, lost dispute): its seat can be sold again. */
export async function voidSeatTx(tx: TenantTx, ctx: Ctx, ticketId: string): Promise<void> {
  await tx
    .update(eventSeats)
    .set({ status: 'available', ticketId: null, heldForOccurrenceId: null, updatedAt: ctx.now })
    .where(and(eq(eventSeats.ticketId, ticketId), eq(eventSeats.status, 'sold')));
}

/** The sweeper: release every hold past its expiry (every 30 s, per org). */
export async function releaseExpiredSeatHoldsTx(tx: TenantTx, ctx: Ctx): Promise<number> {
  const rows = await tx
    .update(eventSeats)
    .set({
      status: 'available',
      holdId: null,
      holdExpiresAt: null,
      heldForOccurrenceId: null,
      updatedAt: ctx.now,
    })
    .where(and(eq(eventSeats.status, 'held'), lte(eventSeats.holdExpiresAt, ctx.now)))
    .returning({ id: eventSeats.id });
  return rows.length;
}

/**
 * Ticket types sold by seat at this event: those need seats chosen, not quantities. For a date
 * (M1.7g), those of the chart it uses; without one, of every chart.
 */
export async function seatedTicketTypesTx(
  tx: TenantTx,
  eventId: string,
  occurrenceId?: string | null,
): Promise<Set<string>> {
  const where =
    occurrenceId === undefined
      ? eq(eventSeats.eventId, eventId)
      : onChart(eventSeats, eventId, await chartKeyTx(tx, eventId, occurrenceId));
  const rows = await tx
    .selectDistinct({ ticketTypeId: eventSeats.ticketTypeId })
    .from(eventSeats)
    .where(and(where, sql`${eventSeats.ticketTypeId} is not null`));
  return new Set(rows.flatMap((r) => (r.ticketTypeId ? [r.ticketTypeId] : [])));
}

/** The seats a hold (an order) has, with their price category and label. */
export async function heldSeatsTx(tx: TenantTx, holdId: string) {
  return tx
    .select({ seatUuid: eventSeats.seatUuid, ticketTypeId: eventSeats.ticketTypeId, label: eventSeats.label })
    .from(eventSeats)
    .where(and(eq(eventSeats.holdId, holdId), eq(eventSeats.status, 'held')))
    .orderBy(eventSeats.label);
}

/** Payment started: the seats wait as long as the order does. */
export async function extendSeatHoldTx(
  tx: TenantTx,
  ctx: Ctx,
  holdId: string,
  expiresAt: Date,
): Promise<void> {
  await tx
    .update(eventSeats)
    .set({ holdExpiresAt: expiresAt, updatedAt: ctx.now })
    .where(and(eq(eventSeats.holdId, holdId), eq(eventSeats.status, 'held')));
}
