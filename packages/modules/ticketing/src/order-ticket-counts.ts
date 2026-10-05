import type { TenantTx } from '@yayatoh/db';
import { inArray, sql } from 'drizzle-orm';
import { tickets } from './schema.ts';

/**
 * How many tickets some orders hold, and how many are still active (M6.4b: the Eventbrite
 * importer's result reproduces the source's attendee count). Counts only.
 */
export async function ticketCountsForOrdersTx(
  tx: TenantTx,
  orderIds: readonly string[],
): Promise<{ all: number; active: number }> {
  let all = 0;
  let active = 0;
  for (let i = 0; i < orderIds.length; i += 1000) {
    const [row] = await tx
      .select({
        all: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${tickets.status} = 'active'))::int`,
      })
      .from(tickets)
      .where(inArray(tickets.orderId, orderIds.slice(i, i + 1000)));
    all += row?.all ?? 0;
    active += row?.active ?? 0;
  }
  return { all, active };
}
