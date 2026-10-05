import type { TenantTx } from '@yayatoh/db';
import { and, eq } from 'drizzle-orm';
import { isOverdue } from './domain/invoices.ts';
import { invoices } from './schema.ts';

/**
 * M5.9a conference Command Center pack: an event's open invoices whose due day has passed in the
 * event's time zone (the invoices page's "overdue"), as a count. Never amounts: the alert names
 * how many, the invoices page shows the money to those who may read orders.
 */
export async function overdueInvoicesTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
  timeZone: string,
): Promise<number> {
  const open = await tx
    .select({ status: invoices.status, dueOn: invoices.dueOn })
    .from(invoices)
    .where(and(eq(invoices.eventId, eventId), eq(invoices.status, 'open')));
  return open.filter((i) => isOverdue(i, now, timeZone)).length;
}
