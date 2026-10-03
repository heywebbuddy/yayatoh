import { type TenantTx, withTenant } from '@yayatoh/db';
import { type CommandPorts, createCtx, executeCommand, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, tenantCommand } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { billingEnabled } from './provider/flag.ts';
import { type BillingProvider, LIVE_SUBSCRIPTION_STATUSES } from './provider/port.ts';
import { orgBilling } from './schema.ts';
import { subscriptionsTx } from './subscriptions.ts';

export type NonprofitSource = 'verified_charity' | 'staff';

/** Set (or clear) the org's nonprofit discount source; returns whether anything changed. */
async function setSourceTx(tx: TenantTx, orgId: string, source: NonprofitSource | null, now: Date) {
  const [row] = await tx.select().from(orgBilling);
  if ((row?.nonprofitDiscount ?? null) === source) return false;
  await tx
    .insert(orgBilling)
    .values({ orgId, nonprofitDiscount: source, discountChangedAt: now })
    .onConflictDoUpdate({
      target: orgBilling.orgId,
      set: { nonprofitDiscount: source, discountChangedAt: now, updatedAt: now },
    });
  return true;
}

/**
 * The nonprofit discount from the charity profile (M4.8b): a verified charity gets the coupon on
 * its subscription; a rejected profile loses it (unless staff granted it by hand). The worker's
 * billing pass then puts it on the provider's subscription (`pushNonprofitDiscount`).
 */
export function nonprofitDiscountFromCharity() {
  return defineSubscriber({
    name: 'billing.nonprofit-discount',
    events: ['donations.charity_verified@1', 'donations.charity_rejected@1'],
    handle: async (tx, event) => {
      const [row] = await tx.select({ d: orgBilling.nonprofitDiscount }).from(orgBilling);
      const now = new Date();
      if (event.type === 'donations.charity_verified') {
        if (!row?.d) await setSourceTx(tx, event.orgId, 'verified_charity', now);
      } else if (row?.d === 'verified_charity') await setSourceTx(tx, event.orgId, null, now);
    },
  });
}

/**
 * Staff: grant or remove the nonprofit discount by hand (an org without a charity profile, e.g. a
 * church). Audited; `platform:entitlements.manage`.
 */
export const setNonprofitDiscountCommand = tenantCommand({
  name: 'billing.setNonprofitDiscount',
  input: z.object({ enabled: z.boolean(), note: z.string().trim().min(3).max(500) }),
  output: z.object({ source: z.enum(['verified_charity', 'staff']).nullable(), changed: z.boolean() }),
  entitlement: null,
  permission: 'platform:entitlements.manage',
  handler: async ({ input, ctx, tx }) => {
    const source = input.enabled ? ('staff' as const) : null;
    const changed = await setSourceTx(tx, requireOrg(ctx), source, ctx.now);
    return { source, changed };
  },
  audit: (input, r) => ({
    action: 'billing.nonprofit_discount',
    targetType: 'organization',
    targetId: null,
    data: { enabled: input.enabled, note: input.note, changed: r.changed },
  }),
});

/** Record that the provider has the org's current discount (system). */
export const markDiscountPushedCommand = tenantCommand({
  name: 'billing.markDiscountPushed',
  input: z.object({ changedAt: z.coerce.date() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: null,
  permission: 'platform:billing.link',
  handler: async ({ input, ctx, tx }) => {
    await tx
      .update(orgBilling)
      .set({ discountPushedAt: input.changedAt, updatedAt: ctx.now })
      .where(eq(orgBilling.orgId, requireOrg(ctx)));
    return { ok: true as const };
  },
  audit: () => ({ action: 'billing.discount_pushed', targetType: 'organization', targetId: null }),
});

/**
 * Put the org's current nonprofit discount on its live subscription at the provider, when it
 * changed since the last push. Without a live subscription nothing is sent (a new subscription
 * gets the coupon when it starts, `changeSubscriptionPlan`). Returns whether the provider was told.
 */
export async function pushNonprofitDiscount(
  orgId: string,
  provider: BillingProvider,
  ports: CommandPorts<TenantTx>,
  opts: { enabled?: boolean } = {},
): Promise<boolean> {
  if (!(opts.enabled ?? billingEnabled())) return false;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'billing:discount' } });
  const work = await withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(orgBilling);
    if (!row?.discountChangedAt || (row.discountPushedAt && row.discountPushedAt >= row.discountChangedAt))
      return null;
    const [sub] = await subscriptionsTx(tx);
    const live = sub && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status) ? sub : null;
    return { row, subscriptionId: live?.providerSubscriptionId ?? null };
  });
  if (!work?.subscriptionId) return false;
  await provider.setDiscount({
    subscriptionId: work.subscriptionId,
    coupon: work.row.nonprofitDiscount ? 'nonprofit' : null,
    idempotencyKey: `billing-discount:${orgId}:${work.row.discountChangedAt?.toISOString()}`,
  });
  await executeCommand(
    markDiscountPushedCommand,
    { changedAt: work.row.discountChangedAt as Date },
    ctx,
    ports,
  );
  return true;
}
