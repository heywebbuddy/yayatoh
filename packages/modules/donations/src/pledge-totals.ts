import type { TenantTx } from '@yayatoh/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { pledgeCollections } from './schema-collection.ts';

/** Offline-paid pledges per campaign (they count in "raised" like paid gifts, P4-12). */
export async function offlinePledgeTotalsTx(tx: TenantTx, campaignIds: readonly string[]) {
  const out = new Map<string, { raisedMinor: number; count: number }>();
  if (campaignIds.length === 0) return out;
  for (const r of await tx
    .select({
      campaignId: pledgeCollections.campaignId,
      sum: sql<string>`coalesce(sum(${pledgeCollections.amountMinor}), 0)::text`,
      n: sql<number>`count(*)::int`,
    })
    .from(pledgeCollections)
    .where(
      and(
        inArray(pledgeCollections.campaignId, [...campaignIds]),
        eq(pledgeCollections.status, 'paid_offline'),
      ),
    )
    .groupBy(pledgeCollections.campaignId))
    out.set(r.campaignId, { raisedMinor: Number(r.sum), count: r.n });
  return out;
}
