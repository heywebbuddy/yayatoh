import type { TenantTx } from '@yayatoh/db';
import { eq, inArray } from 'drizzle-orm';
import { tickets } from './schema.ts';

/**
 * Tickets behind the audiences projector (M3.6): type, status, a bought seat and the order.
 * Internal fields only; nothing here is serialized as is.
 */
export async function ticketFactsTx(tx: TenantTx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  return tx
    .select({
      id: tickets.id,
      ticketTypeId: tickets.ticketTypeId,
      status: tickets.status,
      seatLabel: tickets.seatLabel,
      orderId: tickets.orderId,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(inArray(tickets.id, [...ticketIds]));
}

/** Ids of the tickets an order issued (any status). */
export async function orderTicketIdsTx(tx: TenantTx, orderId: string): Promise<string[]> {
  const rows = await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.orderId, orderId));
  return rows.map((r) => r.id);
}
