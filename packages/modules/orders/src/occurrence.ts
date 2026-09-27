import type { TenantTx } from '@yayatoh/db';
import { findOccurrenceTx, hasOccurrencesTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { activeTicketsForOccurrenceTx } from '@yayatoh/ticketing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { orderLifecycle } from './domain/lifecycle.ts';
import { orderItems, orders } from './schema.ts';

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
  input: { eventId: string; occurrenceId: string | null | undefined; quantity: number; now: Date },
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
    const sold = await activeTicketsForOccurrenceTx(tx, occ.id);
    const [held] = await tx
      .select({ n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        and(eq(orders.occurrenceId, occ.id), inArray(orders.status, [...orderLifecycle.from('expire')])),
      );
    if (sold + (held?.n ?? 0) + input.quantity > occ.capacity)
      throw new DomainError('conflict', 'Not enough tickets left for this date', {
        reason: 'date_sold_out',
        occurrenceId: occ.id,
      });
  }
  return occ.id;
}
