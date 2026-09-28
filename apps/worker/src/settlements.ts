import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type PaymentProvider, settleOrg } from '@yayatoh/payments';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });

/**
 * The Payout Release job (roadmap §5.3, M1.6c; leader only). Finds orgs with held funds, reserves
 * or settlements waiting to move (platform_reader, audited), releases what is due per org under
 * its RLS, then transfers each ready settlement (outside any transaction, idempotent per
 * settlement) and records the provider's answer. Failed transfers are retried on the next run.
 */
export async function runSettlements(
  provider: PaymentProvider,
  opts: { now?: Date; onlyOrgs?: readonly string[] } = {},
): Promise<{ orgs: number; transferred: number; failed: number }> {
  const rows = await withPlatformReader(
    { actor: 'system:settlements', reason: 'find orgs with funds to release or transfer' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`
        select org_id from payments.postings
        where account in ('org:payable_held', 'org:reserve')
        group by org_id, account, currency having sum(amount_minor) <> 0
        union
        select org_id from payments.settlements where status in ('ready', 'failed', 'waiting_account')
        limit 500`),
  );
  const orgs = [...new Set(rows.map((r) => r.org_id))].filter(
    (o) => !opts.onlyOrgs || opts.onlyOrgs.includes(o),
  );
  let transferred = 0;
  let failed = 0;
  for (const orgId of orgs) {
    const r = await settleOrg(provider, orgId, ports, opts.now ? { now: opts.now } : {});
    transferred += r.transferred;
    failed += r.failed;
  }
  return { orgs: orgs.length, transferred, failed };
}
