import type { TenantTx } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { SOLD_STATUSES } from './facts.ts';

const SOLD = sql.raw(SOLD_STATUSES.map((s) => `'${s}'`).join(', '));

/** One sold order of an event (M6.2b attribution): its payment day, currency and gross total. */
export interface SoldOrderDayFact {
  readonly orderId: string;
  /** `YYYY-MM-DD` in the given time zone, by payment time (no payment time: creation). */
  readonly day: string;
  readonly currency: string;
  /** The order's gross total in minor units (refunds are not netted, as in M3.8b). */
  readonly totalMinor: number;
}

/**
 * The sold orders of one event with their payment day in a time zone (the org's): the same
 * orders and days as `dailySalesFactsTx`, one row per order, for the analytics warehouse's
 * attribution rollups. Ids, days and totals only.
 */
export async function soldOrderDaysTx(
  tx: TenantTx,
  eventId: string,
  timeZone: string,
): Promise<SoldOrderDayFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select o.id, to_char(coalesce(o.paid_at, o.created_at) at time zone ${timeZone}, 'YYYY-MM-DD') as day,
      o.currency, o.total_minor::text as total
    from orders.orders o
    where o.status in (${SOLD}) and o.event_id = ${eventId}::uuid
    order by o.id`);
  return rows.map((r) => ({
    orderId: String(r.id),
    day: String(r.day),
    currency: String(r.currency),
    totalMinor: Number(r.total ?? 0),
  }));
}
