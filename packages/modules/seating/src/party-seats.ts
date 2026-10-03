import type { TenantTx } from '@yayatoh/db';
import { isDomainError, uuidv7 } from '@yayatoh/kernel';
import { openFinderTx, type SeatFinderResultDto, seatsOfTx } from './seat-finder.ts';

/**
 * The seats of a wedding or gala party for its guest hub (M4.7a): the same answer as the seat
 * finder (seats given by the host or bought with a ticket, in plan order, published sponsors), for
 * the people the guests module passes (the party's guest-list entries and tickets). Null while the
 * organizer hasn't opened the seat finder: the host decides when guests see seats. Names never
 * leave this function, only seats.
 */
export async function partySeatsTx(
  tx: TenantTx,
  eventId: string,
  people: readonly { attendeeId: string | null; ticketId: string | null }[],
): Promise<SeatFinderResultDto | null> {
  const open = await openFinderTx(tx, eventId, null).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') return null;
    throw err;
  });
  if (!open) return null;
  return seatsOfTx(
    tx,
    open.doc,
    eventId,
    open.chart,
    // A ticket-only person (no guest-list entry) still has a seat through the ticket.
    people.map((p) => ({ id: p.attendeeId ?? uuidv7(), ticketId: p.ticketId })),
  );
}
