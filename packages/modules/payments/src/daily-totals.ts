import type { TenantTx } from '@yayatoh/db';
import { sql } from 'drizzle-orm';

/** One day's money in the ledger for one currency (M6.5d accounting summaries). */
export interface LedgerDayTotals {
  /** `YYYY-MM-DD` in the requested time zone (the org's). */
  readonly day: string;
  readonly currency: string;
  /** Gross sales (`sale` and `organizer_collected_sale` memos: `grossMinor`). */
  readonly salesMinor: number;
  /** Platform fees charged (sale memos' `feeMinor`) less fees given back (refund memos' `feeRefundedMinor`). */
  readonly feesMinor: number;
  /** Money refunded to buyers (refund memos' `amountMinor`). */
  readonly refundsMinor: number;
  /** Payouts sent to the organizer (`transfer` journals: their `org:payable_releasable` debit). */
  readonly payoutsMinor: number;
  /** How many journals the day's totals come from. */
  readonly journals: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The org's ledger per day and currency between `from` and `to` (inclusive, days in `timeZone`),
 * read from the immutable journals inside the caller's tenant transaction. Each journal belongs to
 * the day of its `occurred_at` in that zone; the amounts are the journals' memo entries (gross,
 * fee, refunded, fee refunded) and, for payouts, the transfer itself. Days without journals are
 * absent. Integer minor units throughout.
 */
export async function ledgerDailyTotalsTx(
  tx: TenantTx,
  q: { readonly timeZone: string; readonly from: string; readonly to: string },
): Promise<LedgerDayTotals[]> {
  if (!DAY.test(q.from) || !DAY.test(q.to)) throw new Error('Days are YYYY-MM-DD');
  const rows = await tx.execute<{
    day: string;
    currency: string;
    sales: string;
    fees: string;
    refunds: string;
    payouts: string;
    journals: string;
  }>(sql`
    with j as (
      select j.id, j.kind, j.memo,
        to_char((j.occurred_at at time zone ${q.timeZone})::date, 'YYYY-MM-DD') as day,
        (select min(p.currency) from payments.postings p where p.journal_id = j.id) as currency,
        coalesce((select sum(p.amount_minor) from payments.postings p
          where p.journal_id = j.id and p.account = 'org:payable_releasable'), 0) as releasable
      from payments.journal_entries j
      where j.kind in ('sale', 'organizer_collected_sale', 'refund', 'transfer')
        and j.occurred_at >= (${q.from}::date)::timestamp at time zone ${q.timeZone}
        and j.occurred_at < ((${q.to}::date + 1)::timestamp at time zone ${q.timeZone})
    )
    select day, currency,
      coalesce(sum((memo->>'grossMinor')::bigint) filter (where kind in ('sale', 'organizer_collected_sale')), 0)::text as sales,
      (coalesce(sum((memo->>'feeMinor')::bigint) filter (where kind in ('sale', 'organizer_collected_sale')), 0)
        - coalesce(sum((memo->>'feeRefundedMinor')::bigint) filter (where kind = 'refund'), 0))::text as fees,
      coalesce(sum((memo->>'amountMinor')::bigint) filter (where kind = 'refund'), 0)::text as refunds,
      coalesce(sum(releasable) filter (where kind = 'transfer'), 0)::text as payouts,
      count(*)::text as journals
    from j where currency is not null
    group by day, currency
    order by day, currency`);
  return rows.map((r) => ({
    day: r.day,
    currency: r.currency,
    salesMinor: Number(r.sales),
    feesMinor: Number(r.fees),
    refundsMinor: Number(r.refunds),
    payoutsMinor: Number(r.payouts),
    journals: Number(r.journals),
  }));
}
