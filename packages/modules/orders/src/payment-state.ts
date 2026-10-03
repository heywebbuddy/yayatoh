import type { TenantTx } from '@yayatoh/db';
import { eq } from 'drizzle-orm';
import { orders } from './schema.ts';

/**
 * What a caller needs to (re)start an order's payment (M5.1c: an approved applicant's pay link
 * returns the open order of an earlier attempt instead of making a second one). Null when the
 * order does not exist.
 */
export async function orderPaymentStateTx(tx: TenantTx, orderId: string) {
  const [o] = await tx
    .select({
      id: orders.id,
      status: orders.status,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      buyerEmail: orders.buyerEmail,
      fundsFlow: orders.fundsFlow,
      connectedAccountId: orders.connectedAccountId,
      feeMinor: orders.feeMinor,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!o) return null;
  return {
    ...o,
    applicationFeeMinor: o.fundsFlow === 'organizer_mor' ? o.feeMinor : 0,
    open: ['reserved', 'awaiting_payment', 'payment_failed'].includes(o.status),
  };
}
