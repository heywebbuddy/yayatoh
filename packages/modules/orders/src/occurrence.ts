import type { TenantTx } from '@yayatoh/db';
import { findOccurrenceTx, hasOccurrencesTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { activeTicketsForOccurrenceTx } from '@yayatoh/ticketing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { orderLifecycle } from './domain/lifecycle.ts';
import { orderItems, orders, waitlistEntries } from './schema.ts';

/**
 * M1.4b: a multi-date event sells one date per order. Returns the chosen date's id (null for a
 * single-date event), after checking it is a scheduled, not yet finished date of this event and
 * that its capacity (if any) still has room for `quantity` tickets.
 *
 * Capacity = live tickets for the date + tickets in orders still holding stock for it. The date's
 * row is locked first, so concurrent checkouts for one date count one after the other.
 */
export async function claimOccurrenceTx(
  tx: TenantTx,
  input: {
    eventId: string;
    occurrenceId: string | null | undefined;
    quantity: number;
    now: Date;
    /** Public checkout (M3.10a): places the date's waitlists are waiting for are kept back. */
    waitlistReserve?: boolean;
  },
): Promise<string | null> {
  if (!input.occurrenceId) {
    if (await hasOccurrencesTx(tx, input.eventId))
      throw new DomainError('validation_failed', 'Choose a date', {
        reason: 'choose_date',
        field: 'occurrenceId',
      });
    return null;
  }
  const occ = await findOccurrenceTx(tx, input.occurrenceId, true);
  if (!occ || occ.eventId !== input.eventId) throw new DomainError('not_found', 'Date not found');
  if (occ.status !== 'scheduled')
    throw new DomainError('invalid_state', 'This date is cancelled', { reason: 'date_cancelled' });
  if (occ.endsAt <= input.now)
    throw new DomainError('invalid_state', 'This date has passed', { reason: 'date_passed' });
  if (occ.capacity !== null) {
    const taken = await occurrenceTakenTx(tx, occ.id, input.waitlistReserve === true);
    if (taken + input.quantity > occ.capacity)
      throw new DomainError('conflict', 'Not enough tickets left for this date', {
        reason: 'date_sold_out',
        occurrenceId: occ.id,
      });
  }
  return occ.id;
}

/**
 * Places of a date already spoken for: live tickets, tickets in orders still holding stock, and
 * waitlist offers holding stock for it (M3.10a); with `reserve`, also what the date's waitlists
 * are waiting for.
 */
export async function occurrenceTakenTx(
  tx: TenantTx,
  occurrenceId: string,
  reserve: boolean,
): Promise<number> {
  const sold = await activeTicketsForOccurrenceTx(tx, occurrenceId);
  const [held] = await tx
    .select({ n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(eq(orders.occurrenceId, occurrenceId), inArray(orders.status, [...orderLifecycle.from('expire')])),
    );
  const [queued] = await tx
    .select({
      offered: sql<number>`coalesce(sum(${waitlistEntries.offeredQuantity}) filter (where ${waitlistEntries.status} = 'offered'), 0)::int`,
      waiting: sql<number>`coalesce(sum(${waitlistEntries.quantity}) filter (where ${waitlistEntries.status} = 'waiting'), 0)::int`,
    })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.occurrenceId, occurrenceId),
        inArray(waitlistEntries.status, ['offered', 'waiting']),
      ),
    );
  return sold + (held?.n ?? 0) + (queued?.offered ?? 0) + (reserve ? (queued?.waiting ?? 0) : 0);
}
