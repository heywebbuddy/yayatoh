import type { TenantTx } from '@yayatoh/db';
import { sql } from 'drizzle-orm';

/** One day's online giving for one currency (M6.5d accounting summaries). */
export interface DonationDayTotals {
  /** `YYYY-MM-DD` in the requested time zone (the org's). */
  readonly day: string;
  readonly currency: string;
  /** Paid gifts that day: what donors were charged (the gift plus any fee they chose to cover). */
  readonly donationsMinor: number;
  /** Provider refunds of gifts that day (`gift_refunds`). */
  readonly refundsMinor: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The org's online gifts per day and currency between `from` and `to` (inclusive, days in
 * `timeZone`), inside the caller's tenant transaction: paid gifts by `paid_at`, refunds by
 * `refunded_at`. Gifts are direct charges with application fee 0 (P4-9, P4-10), so the payments
 * ledger has no journal for them; this is their record. Pledges paid offline are not here (no
 * money moved through Yayatoh).
 */
export async function donationDailyTotalsTx(
  tx: TenantTx,
  q: { readonly timeZone: string; readonly from: string; readonly to: string },
): Promise<DonationDayTotals[]> {
  if (!DAY.test(q.from) || !DAY.test(q.to)) throw new Error('Days are YYYY-MM-DD');
  const start = sql`(${q.from}::date)::timestamp at time zone ${q.timeZone}`;
  const end = sql`((${q.to}::date + 1)::timestamp at time zone ${q.timeZone})`;
  const rows = await tx.execute<{ day: string; currency: string; donations: string; refunds: string }>(sql`
    with m as (
      select to_char((g.paid_at at time zone ${q.timeZone})::date, 'YYYY-MM-DD') as day, g.currency,
        (g.amount_minor + g.fee_cover_minor)::bigint as donations, 0::bigint as refunds
      from donations.gifts g
      where g.status = 'paid' and g.paid_at >= ${start} and g.paid_at < ${end}
      union all
      select to_char((r.refunded_at at time zone ${q.timeZone})::date, 'YYYY-MM-DD'), r.currency,
        0::bigint, r.amount_minor::bigint
      from donations.gift_refunds r
      where r.refunded_at >= ${start} and r.refunded_at < ${end}
    )
    select day, currency, sum(donations)::text as donations, sum(refunds)::text as refunds
    from m group by day, currency order by day, currency`);
  return rows.map((r) => ({
    day: r.day,
    currency: r.currency,
    donationsMinor: Number(r.donations),
    refundsMinor: Number(r.refunds),
  }));
}
