import type { TenantTx } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { SOLD_STATUSES } from './facts.ts';

/**
 * Per-day facts of one event for the analytics warehouse (M6.2a): the same orders and refunds as
 * `salesFactsTx` / `refundFactsTx` (so the warehouse adds up to the reports to the cent), grouped
 * by calendar day in a time zone (the org's). Counts and sums only; no order rows.
 */

const SOLD = sql.raw(SOLD_STATUSES.map((s) => `'${s}'`).join(', '));
const n = (v: unknown) => Number(v ?? 0);

export interface DailySalesFact {
  /** `YYYY-MM-DD` in the given time zone, by payment time. */
  readonly day: string;
  readonly currency: string;
  /** A zero-total sold order (free pass, 100 % code, door comp). */
  readonly comp: boolean;
  readonly orders: number;
  readonly tickets: number;
  readonly grossMinor: number;
}

/** Sold orders of one event per day of payment (an order without a payment time: its creation). */
export async function dailySalesFactsTx(
  tx: TenantTx,
  eventId: string,
  timeZone: string,
): Promise<DailySalesFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select to_char(coalesce(o.paid_at, o.created_at) at time zone ${timeZone}, 'YYYY-MM-DD') as day,
      o.currency, (o.total_minor = 0) as comp, count(*)::int as orders,
      coalesce(sum(i.qty), 0)::int as tickets, sum(o.total_minor)::text as gross
    from orders.orders o
    left join lateral (
      select sum(oi.quantity) as qty from orders.order_items oi
      where oi.order_id = o.id and oi.org_id = o.org_id
    ) i on true
    where o.status in (${SOLD}) and o.event_id = ${eventId}::uuid
    group by 1, 2, 3 order by 1, 2, 3`);
  return rows.map((r) => ({
    day: String(r.day),
    currency: String(r.currency),
    comp: Boolean(r.comp),
    orders: n(r.orders),
    tickets: n(r.tickets),
    grossMinor: n(r.gross),
  }));
}

export interface DailyRefundFact {
  /** `YYYY-MM-DD` in the given time zone, by the time the refund succeeded. */
  readonly day: string;
  readonly currency: string;
  readonly refunds: number;
  /** Tickets voided by these refunds. */
  readonly tickets: number;
  readonly amountMinor: number;
}

/** Succeeded refunds of one event per day they completed (without a completion time: creation). */
export async function dailyRefundFactsTx(
  tx: TenantTx,
  eventId: string,
  timeZone: string,
): Promise<DailyRefundFact[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select to_char(coalesce(r.completed_at, r.created_at) at time zone ${timeZone}, 'YYYY-MM-DD') as day,
      r.currency, count(*)::int as refunds, coalesce(sum(cardinality(r.ticket_ids)), 0)::int as tickets,
      sum(r.amount_minor)::text as amount
    from orders.refunds r join orders.orders o on o.id = r.order_id and o.org_id = r.org_id
    where r.status = 'succeeded' and o.event_id = ${eventId}::uuid
    group by 1, 2 order by 1, 2`);
  return rows.map((r) => ({
    day: String(r.day),
    currency: String(r.currency),
    refunds: n(r.refunds),
    tickets: n(r.tickets),
    amountMinor: n(r.amount),
  }));
}
