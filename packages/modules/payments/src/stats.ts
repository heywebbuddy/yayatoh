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
