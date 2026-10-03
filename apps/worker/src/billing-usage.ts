import {
  type BillingProvider,
  billingEntitlements,
  billingReadOnlyGate,
  composeOrgGates,
  pushNonprofitDiscount,
  reportOrgUsage,
} from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCommandPorts } from '@yayatoh/platform';
import { memberRoleTx, orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

// System actors pass both org gates; wired for parity with the apps.
const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: composeOrgGates(orgStatusGate, billingReadOnlyGate({ memberRole: memberRoleTx })),
});

/**
 * Orgs with billing work (M6.6b): a billing customer and usage not yet sent to the provider's
 * meters, or a nonprofit discount the provider doesn't have yet (platform_reader, audited).
 */
export async function orgsWithBillingWork(limit = 200): Promise<string[]> {
  const rows = await withPlatformReader(
    { actor: 'system:billing-usage', reason: 'find orgs with usage to report or a discount to push' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`
        select b.org_id from billing.org_billing b
        where b.provider_customer_id is not null
          and (exists (select 1 from billing.usage_records u where u.org_id = b.org_id and u.reported_at is null)
            or (b.discount_changed_at is not null
              and (b.discount_pushed_at is null or b.discount_pushed_at < b.discount_changed_at)))
        order by b.org_id
        limit ${limit}`),
  );
  return rows.map((r) => r.org_id);
}

export interface BillingPassResult {
  readonly orgs: number;
  readonly reported: number;
  readonly failed: number;
  readonly discounts: number;
}

/**
 * The worker's billing pass (M6.6b), every few minutes while billing is on (leader only): send
 * each org's new usage to the provider's meters and push changed nonprofit discounts. One org's
 * failure never stops the others.
 */
export async function runBillingPass(
  provider: BillingProvider,
  opts: { onlyOrgs?: ReadonlySet<string>; enabled?: boolean } = {},
): Promise<BillingPassResult> {
  let reported = 0;
  let failed = 0;
  let discounts = 0;
  const orgs = (await orgsWithBillingWork()).filter((o) => !opts.onlyOrgs || opts.onlyOrgs.has(o));
  for (const orgId of orgs) {
    try {
      const r = await reportOrgUsage(orgId, provider, ports, { ...(opts.enabled ? { enabled: true } : {}) });
      reported += r.reported;
      failed += r.failed;
      if (await pushNonprofitDiscount(orgId, provider, ports, { ...(opts.enabled ? { enabled: true } : {}) }))
        discounts += 1;
    } catch (err) {
      console.error('billing.usage', orgId, err);
    }
  }
  return { orgs: orgs.length, reported, failed, discounts };
}
