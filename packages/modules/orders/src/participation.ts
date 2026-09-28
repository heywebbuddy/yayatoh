import type { TenantTx } from '@yayatoh/db';
import { eq, sql } from 'drizzle-orm';
import { orders, refunds } from './schema.ts';

/** Paid order states (a refund keeps the order counted as sold; spend is net of refunds). */
const SOLD = sql`('paid', 'partially_refunded', 'refunded')`;

/** An order's event and buyer contact (the audiences projector, M3.6). */
export async function orderRefTx(tx: TenantTx, orderId: string) {
  const [row] = await tx
    .select({ eventId: orders.eventId, buyerContactId: orders.buyerContactId })
    .from(orders)
    .where(eq(orders.id, orderId));
  return row ?? null;
}

/**
 * What each buyer bought for one event (or only some buyers): paid orders still standing (paid or
 * partially refunded), spend net of succeeded refunds, and when they first bought. Mirrors the
 * legacy backfill (M2.2c T9) so live and legacy rows mean the same.
 */
export async function buyerFactsTx(tx: TenantTx, eventId: string, contactIds: readonly string[] | null) {
  if (contactIds !== null && contactIds.length === 0) return [];
  const only =
    contactIds === null
      ? sql``
      : sql` and o.buyer_contact_id = any(ARRAY[${sql.join(
          contactIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[])`;
  const rows = await tx.execute<{
    contact_id: string;
    orders: number;
    spend: string | number;
    first_at: Date | string;
  }>(sql`
    select o.buyer_contact_id as contact_id,
           count(*) filter (where o.status in ('paid', 'partially_refunded'))::int as orders,
           coalesce(sum(greatest(o.total_minor - coalesce((
             select sum(f.amount_minor) from ${refunds} f where f.order_id = o.id and f.status = 'succeeded'
           ), 0), 0)), 0)::bigint as spend,
           min(coalesce(o.paid_at, o.created_at)) as first_at
    from ${orders} o
    where o.event_id = ${eventId} and o.buyer_contact_id is not null and o.status in ${SOLD}${only}
    group by o.buyer_contact_id`);
  return rows.map((r) => ({
    contactId: r.contact_id,
    orders: Number(r.orders),
    spendMinor: Number(r.spend),
    firstAt: new Date(r.first_at),
  }));
}
