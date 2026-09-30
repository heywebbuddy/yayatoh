import type { TenantTx } from '@yayatoh/db';
import { and, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import { disputes } from './schema.ts';

/** What a report covers: one event, a period (by the day a dispute closed), or both. */
export interface DisputeScope {
  readonly eventId?: string;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * Lost disputes per currency (reports, M1.12): money the card network took back from a sale.
 * Periods filter on `closed_at`, half-open [from, to).
 */
export async function lostDisputeFactsTx(
  tx: TenantTx,
  scope: DisputeScope,
): Promise<{ currency: string; disputes: number; amountMinor: number }[]> {
  const where: SQL[] = [eq(disputes.status, 'lost')];
  if (scope.eventId) where.push(eq(disputes.eventId, scope.eventId));
  if (scope.from) where.push(gte(disputes.closedAt, scope.from));
  if (scope.to) where.push(lt(disputes.closedAt, scope.to));
  const rows = await tx
    .select({
      currency: disputes.currency,
      disputes: sql<number>`count(*)::int`,
      amount: sql<string>`sum(${disputes.amountMinor})::text`,
    })
    .from(disputes)
    .where(and(...where))
    .groupBy(disputes.currency)
    .orderBy(disputes.currency);
  return rows.map((r) => ({ currency: r.currency, disputes: r.disputes, amountMinor: Number(r.amount) }));
}

export interface PlatformFeeRow {
  readonly orgId: string;
  readonly currency: string;
  /** Sales that carried a platform fee (online and organizer-collected). */
  readonly sales: number;
  /** Fees on those sales (credits to the platform fee accounts). */
  readonly chargedMinor: number;
  /** Fees given back by refunds. */
  readonly refundedMinor: number;
  /** Charged − refunded ± any other fee postings: the platform's commission. */
  readonly netMinor: number;
}

/**
 * Platform fees (the admin commission report, M1.12c) per org and currency, from the ledger:
 * every posting to `platform:platform_fee_deferred` and `platform:platform_fee_revenue` (moving a
 * fee from deferred to earned nets to zero here). Periods filter on the journal's `occurred_at`.
 * Under platform_reader (apps/admin) it covers every org; under a tenant transaction, only that org.
 */
export async function platformFeesByOrgTx(
  tx: TenantTx,
  period: { readonly from?: Date; readonly to?: Date },
): Promise<PlatformFeeRow[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select p.org_id, p.currency,
      count(distinct j.id) filter (where j.kind in ('sale', 'organizer_collected_sale'))::int as sales,
      coalesce(-sum(p.amount_minor) filter (where j.kind in ('sale', 'organizer_collected_sale')), 0)::text as charged,
      coalesce(sum(p.amount_minor) filter (where j.kind = 'refund'), 0)::text as refunded,
      (-sum(p.amount_minor))::text as net
    from payments.postings p
    join payments.journal_entries j on j.id = p.journal_id and j.org_id = p.org_id
    where p.account in ('platform:platform_fee_deferred', 'platform:platform_fee_revenue')
      ${period.from ? sql`and j.occurred_at >= ${period.from.toISOString()}::timestamptz` : sql``}
      ${period.to ? sql`and j.occurred_at < ${period.to.toISOString()}::timestamptz` : sql``}
    group by p.org_id, p.currency
    order by (-sum(p.amount_minor)) desc, p.org_id, p.currency`);
  return rows.map((r) => ({
    orgId: String(r.org_id),
    currency: String(r.currency),
    sales: Number(r.sales),
    chargedMinor: Number(r.charged),
    refundedMinor: Number(r.refunded),
    netMinor: Number(r.net),
  }));
}
