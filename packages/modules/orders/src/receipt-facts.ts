import type { TenantTx } from '@yayatoh/db';
import { eq } from 'drizzle-orm';
import { donationItems, orderItems, orders } from './schema.ts';

export interface ReceiptOrderFacts {
  readonly id: string;
  readonly eventId: string;
  readonly status: string;
  readonly buyerName: string;
  readonly buyerEmail: string;
  readonly locale: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly fundsFlow: string;
  readonly paidAt: Date | null;
  /** A gift order's donation item (M4.8a), else null. */
  readonly gift: { readonly giftId: string; readonly chargedMinor: number } | null;
  /** Ticket lines: what was paid per ticket to the organizer (face less discount; no platform fee). */
  readonly lines: readonly {
    readonly ticketTypeId: string;
    readonly name: string;
    readonly quantity: number;
    readonly unitPaidMinor: number;
  }[];
}

/**
 * What a receipt needs to know about an order (M4.8b, donations module): who paid, when, how
 * much, under which funds flow, and its gift or ticket lines. Null when the order does not exist.
 */
export async function receiptOrderFactsTx(tx: TenantTx, orderId: string): Promise<ReceiptOrderFacts | null> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return null;
  const [gift] = await tx.select().from(donationItems).where(eq(donationItems.orderId, o.id));
  const items = gift ? [] : await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  return {
    id: o.id,
    eventId: o.eventId,
    status: o.status,
    buyerName: o.buyerName,
    buyerEmail: o.buyerEmail,
    locale: o.locale,
    currency: o.currency,
    totalMinor: o.totalMinor,
    fundsFlow: o.fundsFlow,
    paidAt: o.paidAt,
    gift: gift ? { giftId: gift.giftId, chargedMinor: gift.amountMinor + gift.feeCoverMinor } : null,
    lines: items.map((i) => ({
      ticketTypeId: i.ticketTypeId,
      name: i.name,
      quantity: i.quantity,
      unitPaidMinor: i.unitFaceMinor - i.unitDiscountMinor,
    })),
  };
}
