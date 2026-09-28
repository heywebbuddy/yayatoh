import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type PaymentProvider, reconcileOrgDay, reconWindow } from '@yayatoh/payments';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });

/** The UTC day before `now` (`YYYY-MM-DD`): the day the nightly run reconciles. */
export const previousDay = (now: Date) => new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

/**
 * Daily reconciliation (roadmap §5.3, M1.6e; leader only). Lists the provider's balance
 * transactions for the day's window once, finds the orgs with platform cash in the ledger or
 * provider movements tagged with them (platform_reader, audited), and records one run per org
 * and day under its RLS. Idempotent: a day already reconciled is left as it is. Skipped when the
 * provider cannot list balance transactions.
 */
export async function runReconciliation(
  provider: PaymentProvider,
  opts: { day?: string; now?: Date; onlyOrgs?: readonly string[] } = {},
): Promise<{ day: string; orgs: number; items: number; unattributed: number } | null> {
  const day = opts.day ?? previousDay(opts.now ?? new Date());
  const window = reconWindow(day);
  const listed = await provider.listBalanceTransactions(window);
  if (!listed) return null;
  const rows = await withPlatformReader(
    { actor: 'system:reconciliation', reason: 'find orgs with platform cash to reconcile' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`
        select distinct p.org_id from payments.postings p
        join payments.journal_entries j on j.id = p.journal_id
        where p.account = 'platform:stripe_cash'
          and j.occurred_at >= ${window.from.toISOString()}::timestamptz
          and j.occurred_at < ${window.to.toISOString()}::timestamptz
        limit 5000`),
  );
  const orgs = [
    ...new Set([...rows.map((r) => r.org_id), ...listed.flatMap((t) => (t.orgId ? [t.orgId] : []))]),
  ]
    .filter((o) => /^[0-9a-f-]{36}$/.test(o))
    .filter((o) => !opts.onlyOrgs || opts.onlyOrgs.includes(o));
  let items = 0;
  for (const orgId of orgs) {
    const r = await reconcileOrgDay(provider, orgId, day, ports, {
      transactions: listed,
      ...(opts.now ? { now: opts.now } : {}),
    });
    if (r?.created) items += r.itemCount;
  }
  // Platform movements no org tagged (payouts to the bank, Stripe fees) are not an org's drift.
  const unattributed = listed.filter((t) => !t.orgId && t.kind !== 'other').length;
  return { day, orgs: orgs.length, items, unattributed };
}
