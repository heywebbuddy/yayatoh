import type { TenantTx } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
import { ORDER_STATUSES } from './schema.ts';

/**
 * Read-only facts for reports (M1.12). The reports module derives every metric from these, so a
 * figure means the same on every screen and export. All reads run under the caller's tenant
 * transaction (RLS); nothing here returns order rows.
 */

/** Orders that were paid at some point: they count as sales even if later refunded. */
export const SOLD_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const;

/** What a report covers: one event (all time), a period, or both. Periods are half-open [from, to). */
export interface FactScope {
  readonly eventId?: string;
  readonly from?: Date;
  readonly to?: Date;
  /**
   * One shard of the orders (M3.1 metric projections): orders whose id's last byte modulo
   * `count` is `index` (`metricShardOf` in reports computes the same from the id string).
   */
  readonly shard?: { readonly index: number; readonly count: number };
}

/** Who took the money: the platform (online checkout) or the organizer (box office, Zelle, cash). */
export type SalesChannel = 'online' | 'organizer';

const SOLD = sql.raw(SOLD_STATUSES.map((s) => `'${s}'`).join(', '));
const n = (v: unknown) => Number(v ?? 0);

function scopeSql(scope: FactScope, timeColumn: SQL, alias = sql.raw('o')): SQL {
  const parts: SQL[] = [];
  if (scope.eventId) parts.push(sql`${alias}.event_id = ${scope.eventId}::uuid`);
  if (scope.from) parts.push(sql`${timeColumn} >= ${scope.from.toISOString()}::timestamptz`);
  if (scope.to) parts.push(sql`${timeColumn} < ${scope.to.toISOString()}::timestamptz`);
  if (scope.shard)
    parts.push(
      sql`get_byte(uuid_send(${alias}.id), 15) % ${scope.shard.count}::int = ${scope.shard.index}::int`,
    );
  return parts.length ? sql`and ${sql.join(parts, sql` and `)}` : sql``;
}

export interface SalesFact {
  readonly currency: string;
  readonly channel: SalesChannel;
  /** Complimentary: a sold order with a zero total (free pass, 100 % code, door comp). */
  readonly comp: boolean;
  readonly orders: number;
  readonly tickets: number;
  /** What buyers paid (order totals, fees included). */
  readonly grossMinor: number;
  /** The platform fee inside those totals. */
  readonly feeMinor: number;
  /** Promo discounts already taken off. */
  readonly discountMinor: number;
}

/** Sold orders grouped by currency, channel and comp. Periods filter on `paid_at`. */
export async function salesFactsTx(tx: TenantTx, scope: FactScope): Promise<SalesFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select o.currency, o.collected_by, (o.total_minor = 0) as comp,
      count(*)::int as orders, coalesce(sum(i.qty), 0)::int as tickets,
      sum(o.total_minor)::text as gross, sum(o.fee_minor)::text as fee, sum(o.discount_minor)::text as discount
    from orders.orders o
    left join (select order_id, sum(quantity) as qty from orders.order_items group by order_id) i
      on i.order_id = o.id
    where o.status in (${SOLD}) ${scopeSql(scope, sql`o.paid_at`)}
    group by 1, 2, 3
    order by 1, 2, 3`);
  return rows.map((r) => ({
    currency: String(r.currency),
    channel: r.collected_by === 'organizer' ? 'organizer' : 'online',
    comp: Boolean(r.comp),
    orders: n(r.orders),
    tickets: n(r.tickets),
    grossMinor: n(r.gross),
    feeMinor: n(r.fee),
    discountMinor: n(r.discount),
  }));
}

export interface RefundFact {
  readonly currency: string;
  readonly refunds: number;
  /** Tickets voided by these refunds (an amount-only refund voids none). */
  readonly tickets: number;
  readonly amountMinor: number;
  /** The platform-fee part given back. */
  readonly feeRefundedMinor: number;
}

/** Succeeded refunds per currency. Periods filter on `completed_at` (when the money went back). */
export async function refundFactsTx(tx: TenantTx, scope: FactScope): Promise<RefundFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select r.currency, count(*)::int as refunds, coalesce(sum(cardinality(r.ticket_ids)), 0)::int as tickets,
      sum(r.amount_minor)::text as amount, sum(r.fee_refunded_minor)::text as fee
    from orders.refunds r join orders.orders o on o.id = r.order_id and o.org_id = r.org_id
    where r.status = 'succeeded' ${scopeSql(scope, sql`r.completed_at`)}
    group by 1 order by 1`);
  return rows.map((r) => ({
    currency: String(r.currency),
    refunds: n(r.refunds),
    tickets: n(r.tickets),
    amountMinor: n(r.amount),
    feeRefundedMinor: n(r.fee),
  }));
}

/** Orders per current status. Periods filter on `created_at` (when checkout started). */
export async function orderStatusCountsTx(
  tx: TenantTx,
  scope: FactScope,
): Promise<{ status: (typeof ORDER_STATUSES)[number]; orders: number }[]> {
  const rows = await tx.execute<{ status: string; orders: number }>(sql`
    select o.status, count(*)::int as orders from orders.orders o
    where true ${scopeSql(scope, sql`o.created_at`)}
    group by 1`);
  const by = new Map(rows.map((r) => [r.status, n(r.orders)]));
  return ORDER_STATUSES.map((status) => ({ status, orders: by.get(status) ?? 0 }));
}

export interface TicketTypeSalesFact {
  readonly ticketTypeId: string;
  readonly currency: string;
  /** Paid tickets issued (refunded ones included). */
  readonly tickets: number;
  readonly compTickets: number;
  readonly grossMinor: number;
}

/** Sold tickets per ticket type of one event (order lines of sold orders). */
export async function salesByTicketTypeTx(tx: TenantTx, eventId: string): Promise<TicketTypeSalesFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select i.ticket_type_id, o.currency,
      coalesce(sum(i.quantity) filter (where o.total_minor > 0), 0)::int as tickets,
      coalesce(sum(i.quantity) filter (where o.total_minor = 0), 0)::int as comp,
      sum(i.unit_all_in_minor * i.quantity)::text as gross
    from orders.order_items i join orders.orders o on o.id = i.order_id and o.org_id = i.org_id
    where o.status in (${SOLD}) and o.event_id = ${eventId}::uuid
    group by 1, 2`);
  return rows.map((r) => ({
    ticketTypeId: String(r.ticket_type_id),
    currency: String(r.currency),
    tickets: n(r.tickets),
    compTickets: n(r.comp),
    grossMinor: n(r.gross),
  }));
}

export interface DaySalesFact {
  /** Calendar day `YYYY-MM-DD` in the given timezone. */
  readonly day: string;
  readonly currency: string;
  readonly orders: number;
  readonly tickets: number;
  readonly grossMinor: number;
}

/** Sold orders per calendar day of payment, in `timeZone` (the event's, or the org's). */
export async function salesByDayTx(
  tx: TenantTx,
  scope: FactScope,
  timeZone: string,
): Promise<DaySalesFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select to_char(o.paid_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, o.currency,
      count(*)::int as orders, coalesce(sum(i.qty), 0)::int as tickets, sum(o.total_minor)::text as gross
    from orders.orders o
    left join (select order_id, sum(quantity) as qty from orders.order_items group by order_id) i
      on i.order_id = o.id
    where o.status in (${SOLD}) and o.paid_at is not null ${scopeSql(scope, sql`o.paid_at`)}
    group by 1, 2 order by 1, 2`);
  return rows.map((r) => ({
    day: String(r.day),
    currency: String(r.currency),
    orders: n(r.orders),
    tickets: n(r.tickets),
    grossMinor: n(r.gross),
  }));
}

export interface PromoSalesFact {
  readonly promoCodeId: string;
  readonly currency: string;
  /** Sold orders that used the code. */
  readonly orders: number;
  readonly tickets: number;
  readonly discountMinor: number;
  readonly grossMinor: number;
}

/** Sold orders per promo code of one event. */
export async function salesByPromoCodeTx(tx: TenantTx, eventId: string): Promise<PromoSalesFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select o.promo_code_id, o.currency, count(*)::int as orders, coalesce(sum(i.qty), 0)::int as tickets,
      sum(o.discount_minor)::text as discount, sum(o.total_minor)::text as gross
    from orders.orders o
    left join (select order_id, sum(quantity) as qty from orders.order_items group by order_id) i
      on i.order_id = o.id
    where o.status in (${SOLD}) and o.event_id = ${eventId}::uuid and o.promo_code_id is not null
    group by 1, 2`);
  return rows.map((r) => ({
    promoCodeId: String(r.promo_code_id),
    currency: String(r.currency),
    orders: n(r.orders),
    tickets: n(r.tickets),
    discountMinor: n(r.discount),
    grossMinor: n(r.gross),
  }));
}

export interface EventSalesFact {
  readonly eventId: string;
  readonly currency: string;
  readonly orders: number;
  readonly tickets: number;
  readonly compTickets: number;
  readonly grossMinor: number;
}

/** Sold orders per event (the org report). Periods filter on `paid_at`. */
export async function salesByEventTx(tx: TenantTx, scope: FactScope): Promise<EventSalesFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select o.event_id, o.currency, count(*)::int as orders,
      coalesce(sum(i.qty) filter (where o.total_minor > 0), 0)::int as tickets,
      coalesce(sum(i.qty) filter (where o.total_minor = 0), 0)::int as comp,
      sum(o.total_minor)::text as gross
    from orders.orders o
    left join (select order_id, sum(quantity) as qty from orders.order_items group by order_id) i
      on i.order_id = o.id
    where o.status in (${SOLD}) ${scopeSql(scope, sql`o.paid_at`)}
    group by 1, 2 order by sum(o.total_minor) desc, 1, 2`);
  return rows.map((r) => ({
    eventId: String(r.event_id),
    currency: String(r.currency),
    orders: n(r.orders),
    tickets: n(r.tickets),
    compTickets: n(r.comp),
    grossMinor: n(r.gross),
  }));
}

/** Where one order sits in the metric projections (M3.1): its event and payment time. No order row. */
export async function orderMetricRefTx(
  tx: TenantTx,
  orderId: string,
): Promise<{ eventId: string; paidAt: Date | null } | null> {
  const [r] = await tx.execute<{ event_id: string; paid_at: string | Date | null }>(sql`
    select o.event_id, o.paid_at from orders.orders o where o.id = ${orderId}::uuid`);
  if (!r) return null;
  return { eventId: String(r.event_id), paidAt: r.paid_at ? new Date(r.paid_at) : null };
}

/** Where one refund sits in the metric projections: its order, event and completion time. */
export async function refundMetricRefTx(
  tx: TenantTx,
  refundId: string,
): Promise<{ orderId: string; eventId: string; completedAt: Date | null } | null> {
  const [r] = await tx.execute<{
    order_id: string;
    event_id: string;
    completed_at: string | Date | null;
  }>(sql`
    select r.order_id, o.event_id, r.completed_at
    from orders.refunds r join orders.orders o on o.id = r.order_id and o.org_id = r.org_id
    where r.id = ${refundId}::uuid`);
  if (!r) return null;
  return {
    orderId: String(r.order_id),
    eventId: String(r.event_id),
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
  };
}

/** Time-series grains for the metric projections (UTC buckets). */
export type SeriesBucket = 'minute' | 'hour';

export interface SalesSeriesFact {
  readonly bucketStart: Date;
  readonly shard: number;
  readonly currency: string;
  readonly comp: boolean;
  readonly orders: number;
  readonly tickets: number;
  readonly grossMinor: number;
}

/**
 * Sold orders of one event per UTC bucket of payment time and order shard (M3.1 time series).
 * With `from`/`to` (and `shard`) in scope it reads one bucket window; without, the whole event
 * (a rebuild). The same query serves both, so projections and rebuilds agree to the unit.
 */
export async function salesSeriesTx(
  tx: TenantTx,
  scope: FactScope & { readonly eventId: string },
  bucket: SeriesBucket,
  shards: number,
): Promise<SalesSeriesFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select date_trunc(${bucket}, o.paid_at, 'UTC') as bucket_start,
      get_byte(uuid_send(o.id), 15) % ${shards}::int as shard,
      o.currency, (o.total_minor = 0) as comp,
      count(*)::int as orders, coalesce(sum(i.qty), 0)::int as tickets, sum(o.total_minor)::text as gross
    from orders.orders o
    left join (select order_id, sum(quantity) as qty from orders.order_items group by order_id) i
      on i.order_id = o.id
    where o.status in (${SOLD}) and o.paid_at is not null ${scopeSql(scope, sql`o.paid_at`)}
    group by 1, 2, 3, 4`);
  return rows.map((r) => ({
    bucketStart: new Date(r.bucket_start as string),
    shard: n(r.shard),
    currency: String(r.currency),
    comp: Boolean(r.comp),
    orders: n(r.orders),
    tickets: n(r.tickets),
    grossMinor: n(r.gross),
  }));
}

export interface RefundSeriesFact {
  readonly bucketStart: Date;
  readonly shard: number;
  readonly currency: string;
  readonly tickets: number;
  readonly amountMinor: number;
}

/** Succeeded refunds of one event per UTC bucket of completion and order shard (see salesSeriesTx). */
export async function refundSeriesTx(
  tx: TenantTx,
  scope: FactScope & { readonly eventId: string },
  bucket: SeriesBucket,
  shards: number,
): Promise<RefundSeriesFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select date_trunc(${bucket}, r.completed_at, 'UTC') as bucket_start,
      get_byte(uuid_send(o.id), 15) % ${shards}::int as shard, r.currency,
      coalesce(sum(cardinality(r.ticket_ids)), 0)::int as tickets, sum(r.amount_minor)::text as amount
    from orders.refunds r join orders.orders o on o.id = r.order_id and o.org_id = r.org_id
    where r.status = 'succeeded' and r.completed_at is not null ${scopeSql(scope, sql`r.completed_at`)}
    group by 1, 2, 3`);
  return rows.map((r) => ({
    bucketStart: new Date(r.bucket_start as string),
    shard: n(r.shard),
    currency: String(r.currency),
    tickets: n(r.tickets),
    amountMinor: n(r.amount),
  }));
}
