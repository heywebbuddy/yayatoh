import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { eventLayouts, eventSeats } from './schema.ts';

/**
 * Hold seats for a checkout (ADR 0012): one statement moves every requested seat from
 * `available` to `held` under a short lock timeout. If fewer rows move than were asked for, the
 * seats are taken and the caller's transaction must roll back (`conflict`, reason `seats_taken`).
 */
export async function holdSeatsTx(
  tx: TenantTx,
  ctx: Ctx,
  h: { eventId: string; seatUuids: readonly string[]; holdId: string; expiresAt: Date },
): Promise<{ seatUuid: string; ticketTypeId: string | null; label: string }[]> {
  const ids = [...new Set(h.seatUuids)];
  if (ids.length === 0) return [];
  const [layout] = await tx
    .select({ status: eventLayouts.status })
    .from(eventLayouts)
    .where(eq(eventLayouts.eventId, h.eventId));
  if (!layout || layout.status === 'draft')
    throw new DomainError('invalid_state', 'Seats are not on sale', { reason: 'seats_not_on_sale' });
  await tx.execute(sql`set local lock_timeout = '2s'`);
  const rows = await tx
    .update(eventSeats)
    .set({ status: 'held', holdId: h.holdId, holdExpiresAt: h.expiresAt, updatedAt: ctx.now })
    .where(
      and(
        eq(eventSeats.eventId, h.eventId),
        inArray(eventSeats.seatUuid, ids),
        eq(eventSeats.status, 'available'),
      ),
    )
    .returning({
      seatUuid: eventSeats.seatUuid,
      ticketTypeId: eventSeats.ticketTypeId,
      label: eventSeats.label,
    });
  if (rows.length !== ids.length)
    throw new DomainError('conflict', 'Some of those seats were just taken', { reason: 'seats_taken' });
  return rows;
}

/** The hold became a sale: seats are sold to their tickets, and the event's layout locks. */
export async function sellSeatsTx(
  tx: TenantTx,
  ctx: Ctx,
  s: { eventId: string; holdId: string; tickets: readonly { seatUuid: string; ticketId: string }[] },
): Promise<void> {
  for (const t of s.tickets) {
    const rows = await tx
      .update(eventSeats)
      .set({ status: 'sold', ticketId: t.ticketId, holdId: null, holdExpiresAt: null, updatedAt: ctx.now })
      .where(
        and(
          eq(eventSeats.eventId, s.eventId),
          eq(eventSeats.seatUuid, t.seatUuid),
          eq(eventSeats.holdId, s.holdId),
        ),
      )
      .returning({ id: eventSeats.id });
    if (rows.length !== 1)
      throw new DomainError('conflict', 'The seat hold was lost', { reason: 'hold_lost' });
  }
  await tx
    .update(eventLayouts)
    .set({ status: 'locked', lockedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(eventLayouts.eventId, s.eventId), eq(eventLayouts.status, 'published')));
}

/** Give a hold's seats back (checkout expired or abandoned). */
export async function releaseSeatHoldTx(tx: TenantTx, ctx: Ctx, holdId: string): Promise<number> {
  const rows = await tx
    .update(eventSeats)
    .set({ status: 'available', holdId: null, holdExpiresAt: null, updatedAt: ctx.now })
    .where(and(eq(eventSeats.holdId, holdId), eq(eventSeats.status, 'held')))
    .returning({ id: eventSeats.id });
  return rows.length;
}

/** A seated ticket was voided (refund, lost dispute): its seat can be sold again. */
export async function voidSeatTx(tx: TenantTx, ctx: Ctx, ticketId: string): Promise<void> {
  await tx
    .update(eventSeats)
    .set({ status: 'available', ticketId: null, updatedAt: ctx.now })
    .where(and(eq(eventSeats.ticketId, ticketId), eq(eventSeats.status, 'sold')));
}

/** The sweeper: release every hold past its expiry (every 30 s, per org). */
export async function releaseExpiredSeatHoldsTx(tx: TenantTx, ctx: Ctx): Promise<number> {
  const rows = await tx
    .update(eventSeats)
    .set({ status: 'available', holdId: null, holdExpiresAt: null, updatedAt: ctx.now })
    .where(and(eq(eventSeats.status, 'held'), lte(eventSeats.holdExpiresAt, ctx.now)))
    .returning({ id: eventSeats.id });
  return rows.length;
}
