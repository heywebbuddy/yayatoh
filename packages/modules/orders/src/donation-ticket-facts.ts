import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { orderItems, orders } from './schema.ts';

/** One paid line of a donation ticket type ("pay what you want" tickets, M4.8g reports). */
export interface DonationTicketLine {
  readonly orderId: string;
  readonly ticketTypeId: string;
  readonly name: string;
  readonly quantity: number;
  /** Paid per ticket to the organizer: face less discount (no platform fee). */
  readonly unitPaidMinor: number;
  readonly currency: string;
  readonly buyerName: string;
  readonly buyerEmail: string;
  readonly paidAt: Date | null;
}

/**
 * The event's paid lines of the given (donation) ticket types (M4.8g, donations reports): orders
 * that are paid or partly refunded; fully refunded and unpaid orders are left out.
 */
export async function donationTicketLinesTx(
  tx: TenantTx,
  eventId: string,
  ticketTypeIds: readonly string[],
): Promise<DonationTicketLine[]> {
  if (ticketTypeIds.length === 0) return [];
  const rows = await tx
    .select({
      orderId: orders.id,
      ticketTypeId: orderItems.ticketTypeId,
      name: orderItems.name,
      quantity: orderItems.quantity,
      face: orderItems.unitFaceMinor,
      discount: orderItems.unitDiscountMinor,
      currency: orders.currency,
      buyerName: orders.buyerName,
      buyerEmail: orders.buyerEmail,
      paidAt: orders.paidAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orders.eventId, eventId),
        inArray(orders.status, ['paid', 'partially_refunded']),
        inArray(orderItems.ticketTypeId, [...ticketTypeIds]),
      ),
    )
    .orderBy(asc(orders.paidAt), asc(orders.id));
  return rows.map(({ face, discount, ...r }) => ({ ...r, unitPaidMinor: face - discount }));
}
