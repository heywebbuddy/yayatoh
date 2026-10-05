import type { TenantTx } from '@yayatoh/db';
import { and, eq, inArray } from 'drizzle-orm';
import { tickets } from './schema.ts';

/**
 * M5.1d: mark (or clear) an order's tickets as sold on an invoice whose balance is still due. The
 * door (`checkin.scanTicket`) and the badge desk refuse them without an audited staff override.
 * Returns how many tickets changed.
 */
export async function setOrderPaymentDueTx(
  tx: TenantTx,
  orderId: string,
  due: boolean,
  now: Date,
): Promise<number> {
  const rows = await tx
    .update(tickets)
    .set({ paymentDue: due, updatedAt: now })
    .where(and(eq(tickets.orderId, orderId), eq(tickets.paymentDue, !due)))
    .returning({ id: tickets.id });
  return rows.length;
}

/** Which of these tickets still have a balance due (badges, the door). */
export async function paymentDueTicketIdsTx(
  tx: TenantTx,
  ticketIds: readonly string[],
): Promise<Set<string>> {
  if (ticketIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(inArray(tickets.id, [...ticketIds]), eq(tickets.paymentDue, true)));
  return new Set(rows.map((r) => r.id));
}
