import type { TenantTx } from '@yayatoh/db';
import { inArray, type SQL, sql } from 'drizzle-orm';
import { SOLD_STATUSES } from './facts.ts';
import { orders } from './schema.ts';

/**
 * Read-only money facts for the org Money dashboards (U5). Same definitions as `facts.ts`: sales
 * are sold orders by `paid_at`, refunds are succeeded refunds by `completed_at`, so a day's or an
 * order's figures add up to the metric registry's totals. Nothing here returns order rows.
 */

const SOLD = sql.raw(SOLD_STATUSES.map((s) => `'${s}'`).join(', '));
const n = (v: unknown) => Number(v ?? 0);

export interface MoneyScope {
  readonly from?: Date;
  readonly to?: Date;
}

const range = (col: SQL, s: MoneyScope): SQL =>
  sql.join(
    [
      s.from ? sql`and ${col} >= ${s.from.toISOString()}::timestamptz` : sql``,
      s.to ? sql`and ${col} < ${s.to.toISOString()}::timestamptz` : sql``,
    ],
    sql` `,
  );

export interface DayMoneyFact {
  /** Calendar day `YYYY-MM-DD` in the given time zone. */
  readonly day: string;
  readonly currency: string;
  readonly grossMinor: number;
  readonly feeMinor: number;
  readonly refundsMinor: number;
  readonly feeRefundedMinor: number;
}

/** Sales (by payment day) and refunds (by the day they succeeded) per day and currency. */
export async function moneyByDayTx(
  tx: TenantTx,
  scope: MoneyScope,
  timeZone: string,
): Promise<DayMoneyFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select day, currency, sum(gross)::text as gross, sum(fee)::text as fee,
      sum(refunds)::text as refunds, sum(fee_refunded)::text as fee_refunded
    from (
      select to_char(o.paid_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, o.currency,
        o.total_minor as gross, o.fee_minor as fee, 0::bigint as refunds, 0::bigint as fee_refunded
      from orders.orders o
      where o.status in (${SOLD}) and o.paid_at is not null ${range(sql`o.paid_at`, scope)}
      union all
      select to_char(r.completed_at at time zone ${timeZone}, 'YYYY-MM-DD'), r.currency,
        0, 0, r.amount_minor, r.fee_refunded_minor
      from orders.refunds r join orders.orders o on o.id = r.order_id and o.org_id = r.org_id
      where r.status = 'succeeded' and r.completed_at is not null ${range(sql`r.completed_at`, scope)}
    ) m
    group by day, currency order by day, currency`);
  return rows.map((r) => ({
    day: String(r.day),
    currency: String(r.currency),
    grossMinor: n(r.gross),
    feeMinor: n(r.fee),
    refundsMinor: n(r.refunds),
    feeRefundedMinor: n(r.fee_refunded),
  }));
}

/** Events with a sale or a refund in the scope. */
export async function moneyEventIdsTx(tx: TenantTx, scope: MoneyScope): Promise<string[]> {
  const rows = await tx.execute<{ event_id: string }>(sql`
    select o.event_id from orders.orders o
    where o.status in (${SOLD}) and o.paid_at is not null ${range(sql`o.paid_at`, scope)}
    union
    select o.event_id from orders.refunds r join orders.orders o on o.id = r.order_id and o.org_id = r.org_id
    where r.status = 'succeeded' and r.completed_at is not null ${range(sql`r.completed_at`, scope)}`);
  return rows.map((r) => r.event_id);
}

export interface OrderFeeFact {
  readonly orderId: string;
  readonly eventId: string;
  readonly paidAt: Date;
  readonly currency: string;
  readonly totalMinor: number;
  /** The platform fee taken on the order. */
  readonly feeMinor: number;
  /** The part of it given back by succeeded refunds (any time). */
  readonly feeRefundedMinor: number;
  readonly channel: 'online' | 'organizer';
}

/** Fees taken per sold order paid in the scope, newest first (orders with a fee only). */
export async function orderFeesTx(tx: TenantTx, scope: MoneyScope, limit: number): Promise<OrderFeeFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select o.id, o.event_id, o.paid_at, o.currency, o.total_minor::text as total, o.fee_minor::text as fee,
      coalesce((select sum(r.fee_refunded_minor) from orders.refunds r
        where r.order_id = o.id and r.org_id = o.org_id and r.status = 'succeeded'), 0)::text as fee_refunded,
      o.collected_by
    from orders.orders o
    where o.status in (${SOLD}) and o.paid_at is not null and o.fee_minor > 0 ${range(sql`o.paid_at`, scope)}
    order by o.paid_at desc, o.id desc limit ${limit}`);
  return rows.map((r) => ({
    orderId: String(r.id),
    eventId: String(r.event_id),
    paidAt: r.paid_at instanceof Date ? r.paid_at : new Date(String(r.paid_at)),
    currency: String(r.currency),
    totalMinor: n(r.total),
    feeMinor: n(r.fee),
    feeRefundedMinor: n(r.fee_refunded),
    channel: r.collected_by === 'organizer' ? 'organizer' : 'online',
  }));
}

export interface OrderMoneyRow {
  readonly orderId: string;
  readonly eventId: string;
  readonly buyerName: string;
  readonly status: string;
}

/** The buyer and status of some orders (a payout's drill-down names its orders). */
export async function orderMoneyRowsTx(tx: TenantTx, orderIds: readonly string[]): Promise<OrderMoneyRow[]> {
  if (orderIds.length === 0) return [];
  return tx
    .select({
      orderId: orders.id,
      eventId: orders.eventId,
      buyerName: orders.buyerName,
      status: orders.status,
    })
    .from(orders)
    .where(inArray(orders.id, [...new Set(orderIds)]));
}
