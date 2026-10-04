import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { tickets } from './schema.ts';

/**
 * M6.9b: an event's active tickets with their holders (Zoom registrants, CE certificates), in
 * serial order; or exactly `ticketIds` when given. Internal fields: callers serialize their own.
 */
export async function eventHoldersTx(
  tx: TenantTx,
  eventId: string,
  ticketIds?: readonly string[],
): Promise<
  {
    readonly id: string;
    readonly ticketTypeId: string;
    readonly orderId: string;
    readonly holderName: string;
    readonly holderEmail: string;
  }[]
> {
  if (ticketIds && ticketIds.length === 0) return [];
  return tx
    .select({
      id: tickets.id,
      ticketTypeId: tickets.ticketTypeId,
      orderId: tickets.orderId,
      holderName: tickets.holderName,
      holderEmail: tickets.holderEmail,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.eventId, eventId),
        eq(tickets.status, 'active'),
        ...(ticketIds ? [inArray(tickets.id, [...ticketIds])] : []),
      ),
    )
    .orderBy(asc(tickets.serial));
}
