import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { chartKeyTx, onChart } from './chart.ts';
import { emitAssignmentsChangedTx } from './participation.ts';
import { eventSeats } from './schema.ts';

export interface MovedSeat {
  readonly ticketId: string;
  readonly fromLabel: string;
  readonly toLabel: string;
}

/**
 * Move the seat a ticket was bought with to another seat (organizer action). The target is a free
 * seat, or a seat sold to another ticket, in which case the two tickets swap seats. The tickets
 * stay valid: only the seat rows change. Returns each ticket with its old and new seat label so
 * the caller can update the label shown on the ticket. Both rows are locked in a fixed order.
 */
export async function moveSoldSeatTx(
  tx: TenantTx,
  ctx: Ctx,
  m: { eventId: string; occurrenceId?: string | null; ticketId: string; toSeatUuid: string },
): Promise<{ moved: MovedSeat[]; swapped: boolean; priceCategoryChanged: boolean }> {
  const key = await chartKeyTx(tx, m.eventId, m.occurrenceId);
  const [mine] = await tx
    .select({ seatUuid: eventSeats.seatUuid })
    .from(eventSeats)
    .where(
      and(
        onChart(eventSeats, m.eventId, key),
        eq(eventSeats.ticketId, m.ticketId),
        eq(eventSeats.status, 'sold'),
      ),
    );
  if (!mine) throw new DomainError('invalid_state', 'This ticket has no bought seat', { reason: 'no_seat' });
  if (mine.seatUuid === m.toSeatUuid)
    throw new DomainError('validation_failed', 'That is already their seat', { reason: 'same_seat' });
  await tx.execute(sql`set local lock_timeout = '2s'`);
  const rows = await tx
    .select()
    .from(eventSeats)
    .where(
      and(onChart(eventSeats, m.eventId, key), inArray(eventSeats.seatUuid, [mine.seatUuid, m.toSeatUuid])),
    )
    .orderBy(eventSeats.seatUuid)
    .for('update');
  const from = rows.find((r) => r.seatUuid === mine.seatUuid);
  const to = rows.find((r) => r.seatUuid === m.toSeatUuid);
  if (!from || from.ticketId !== m.ticketId || from.status !== 'sold')
    throw new DomainError('conflict', 'The seat changed meanwhile', { reason: 'seat_taken' });
  if (!to) throw new DomainError('not_found', 'No such seat', { field: 'toSeatUuid' });
  if (!to.ticketTypeId)
    throw new DomainError('validation_failed', 'That seat is not on sale', { reason: 'seat_not_on_sale' });
  const swapped = to.status === 'sold' && to.ticketId !== null;
  if (!swapped && to.status !== 'available')
    throw new DomainError('conflict', 'That seat is not free', {
      reason: to.status === 'blocked' ? 'seat_blocked' : 'seat_taken',
    });
  const where = (seatUuid: string) =>
    and(onChart(eventSeats, m.eventId, key), eq(eventSeats.seatUuid, seatUuid));
  if (swapped) {
    // The sold-check allows both rows to be sold while their tickets trade places.
    await tx
      .update(eventSeats)
      .set({ ticketId: to.ticketId, updatedAt: ctx.now })
      .where(where(from.seatUuid));
    await tx
      .update(eventSeats)
      .set({ ticketId: from.ticketId, updatedAt: ctx.now })
      .where(where(to.seatUuid));
  } else {
    await tx
      .update(eventSeats)
      .set({
        status: 'sold',
        ticketId: m.ticketId,
        heldForOccurrenceId: from.heldForOccurrenceId,
        updatedAt: ctx.now,
      })
      .where(where(to.seatUuid));
    await tx
      .update(eventSeats)
      .set({ status: 'available', ticketId: null, heldForOccurrenceId: null, updatedAt: ctx.now })
      .where(where(from.seatUuid));
  }
  await emitAssignmentsChangedTx(tx, ctx, [{ eventId: m.eventId, attendeeId: null }]);
  const moved: MovedSeat[] = [{ ticketId: m.ticketId, fromLabel: from.label, toLabel: to.label }];
  if (swapped && to.ticketId) moved.push({ ticketId: to.ticketId, fromLabel: to.label, toLabel: from.label });
  return { moved, swapped, priceCategoryChanged: from.ticketTypeId !== to.ticketTypeId };
}
