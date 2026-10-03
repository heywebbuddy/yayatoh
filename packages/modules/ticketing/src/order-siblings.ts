import type { TenantTx } from '@yayatoh/db';
import { and, eq, inArray, or } from 'drizzle-orm';
import { tickets } from './schema.ts';

/**
 * M5.6a: the live tickets of the orders behind some tickets (the tickets themselves included),
 * with their type: registration reads a registrant's add-ons from it for session doors. Ids and
 * types only.
 */
export async function orderSiblingsTx(
  tx: TenantTx,
  ticketIds: readonly string[],
): Promise<{ id: string; orderId: string; ticketTypeId: string; status: string; eventId: string }[]> {
  if (ticketIds.length === 0) return [];
  const ids = [...ticketIds];
  return tx
    .select({
      id: tickets.id,
      orderId: tickets.orderId,
      ticketTypeId: tickets.ticketTypeId,
      status: tickets.status,
      eventId: tickets.eventId,
    })
    .from(tickets)
    .where(
      or(
        inArray(tickets.id, ids),
        and(
          eq(tickets.status, 'active'),
          inArray(
            tickets.orderId,
            tx.select({ orderId: tickets.orderId }).from(tickets).where(inArray(tickets.id, ids)),
          ),
        ),
      ),
    );
}
