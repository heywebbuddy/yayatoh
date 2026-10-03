import type { TenantTx } from '@yayatoh/db';
import { inArray } from 'drizzle-orm';
import { orders } from './schema.ts';

/** M6.9b: the language each order was placed in (CE certificates speak the attendee's language). */
export async function orderLocalesTx(
  tx: TenantTx,
  orderIds: readonly string[],
): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: orders.id, locale: orders.locale })
    .from(orders)
    .where(inArray(orders.id, [...new Set(orderIds)]));
  return new Map(rows.map((r) => [r.id, r.locale]));
}
