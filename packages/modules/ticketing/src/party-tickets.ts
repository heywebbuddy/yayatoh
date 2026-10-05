import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ticketBarcodes, tickets, ticketTypes } from './schema.ts';

/**
 * The active tickets among these ids, of this event, with their current signed code (M4.7a guest
 * hub: the guests module passes the tickets its party's guests hold). Voided, transferred and
 * refunded tickets are left out, so a ticket that changed hands leaves the party's hub at once.
 */
export async function partyTicketsTx(tx: TenantTx, eventId: string, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  return tx
    .select({
      id: tickets.id,
      serial: tickets.serial,
      shortCode: tickets.shortCode,
      holderName: tickets.holderName,
      typeName: ticketTypes.name,
      code: ticketBarcodes.payload,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .innerJoin(
      ticketBarcodes,
      and(
        eq(ticketBarcodes.ticketId, tickets.id),
        eq(ticketBarcodes.format, 'yy1'),
        eq(ticketBarcodes.active, true),
        eq(ticketBarcodes.rev, tickets.rev),
      ),
    )
    .where(
      and(eq(tickets.eventId, eventId), eq(tickets.status, 'active'), inArray(tickets.id, [...ticketIds])),
    )
    .orderBy(asc(tickets.serial))
    .limit(200);
}
