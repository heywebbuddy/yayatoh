import { tenantQuery } from '@yayatoh/platform';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { effectiveModulesTx } from './entitlements.ts';
import { billingEnabled } from './provider/flag.ts';
import { LIVE_SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUSES } from './provider/port.ts';
import { orgBilling, planCatalog, planPrices, plans } from './schema.ts';
import { feePlanKeyTx, planModulesOf, subscriptionsTx } from './subscriptions.ts';

const PriceDto = z.object({
  lookupKey: z.string(),
  currency: z.string(),
  interval: z.enum(['month', 'year']),
  unitAmountMinor: z.int().min(0).nullable(),
  active: z.boolean(),
});

/** What the plan page may show (allowlist): no provider ids, customer ids or event data. */
export const PlanSummaryDto = z.object({
  /** BILLING_ENABLED for this deployment. */
  billingEnabled: z.boolean(),
  /** Billing applies to this org: switched on and the org has a billing customer. */
  active: z.boolean(),
  plan: z.object({
    key: z.string(),
    name: z.string(),
    source: z.enum(['subscription', 'plan']),
  }),
  subscription: z
    .object({
      status: z.enum(SUBSCRIPTION_STATUSES),
      live: z.boolean(),
      price: PriceDto.nullable(),
      currentPeriodEnd: z.date().nullable(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .nullable(),
  /** The plan whose per-ticket fee schedule applies. */
  feePlan: z.object({ key: z.string(), name: z.string() }),
  legacyFees: z.object({
    grandfathered: z.boolean(),
    reason: z.enum(['existing_org', 'legacy_migration', 'staff']).nullable(),
  }),
  /** The org's effective module keys (sorted). */
  modules: z.array(z.string()),
  /** The plan catalog (placeholders stay switched off until the owner prices plans, D22). */
  catalog: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      active: z.boolean(),
      modules: z.array(z.string()),
      prices: z.array(PriceDto),
    }),
  ),
});
export type PlanSummary = z.infer<typeof PlanSummaryDto>;

/**
 * The plan page (M6.6a; read-only while billing is dormant): the org's current plan and where it
 * comes from, its subscription if any, its legacy-fee status, its modules and the plan catalog.
 * Owners, admins and finance (`billing:read`).
 */
export const planSummaryQuery = tenantQuery({
  name: 'billing.planSummary',
  input: z.object({}),
  output: PlanSummaryDto,
  entitlement: null,
  permission: 'billing:read',
  handler: async ({ tx }) => {
    const enabled = billingEnabled();
    const [account] = await tx.select().from(orgBilling);
    const allPlans = await tx.select({ key: plans.key, name: plans.name }).from(plans);
    const nameOf = (k: string) => allPlans.find((p) => p.key === k)?.name ?? k;
    const catalogRows = await tx.select().from(planCatalog).orderBy(asc(planCatalog.sortOrder));
    const priceRows = await tx.select().from(planPrices).orderBy(asc(planPrices.lookupKey));
    const price = (p: (typeof priceRows)[number]) => ({
      lookupKey: p.lookupKey,
      currency: p.currency,
      interval: p.billingInterval as 'month' | 'year',
      unitAmountMinor: p.unitAmountMinor,
      active: p.active,
    });
    const modulesByPlan = await planModulesOf(
      tx,
      catalogRows.map((c) => c.planKey),
    );
    const feePlanKey = await feePlanKeyTx(tx);
    const active = enabled && Boolean(account?.providerCustomerId);
    const [sub] = active ? await subscriptionsTx(tx) : [];
    const live = sub ? (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status) : false;
    const subPrice = sub?.priceLookupKey
      ? priceRows.find((p) => p.lookupKey === sub.priceLookupKey)
      : undefined;
    const planKey = sub && live && sub.planKey ? sub.planKey : feePlanKey;
    return {
      billingEnabled: enabled,
      active,
      plan: {
        key: planKey,
        name: nameOf(planKey),
        source: sub && live && sub.planKey ? 'subscription' : 'plan',
      },
      subscription: sub
        ? {
            status: sub.status as (typeof SUBSCRIPTION_STATUSES)[number],
            live,
            price: subPrice ? price(subPrice) : null,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          }
        : null,
      feePlan: { key: feePlanKey, name: nameOf(feePlanKey) },
      legacyFees: {
        grandfathered: account?.legacyFeesGrandfathered ?? false,
        reason: (account?.grandfatheredReason as PlanSummary['legacyFees']['reason']) ?? null,
      },
      modules: [...(await effectiveModulesTx(tx))].sort(),
      catalog: catalogRows.map((c) => ({
        key: c.planKey,
        name: nameOf(c.planKey),
        active: c.active,
        modules: modulesByPlan.get(c.planKey) ?? [],
        prices: priceRows.filter((p) => p.planKey === c.planKey).map(price),
      })),
    };
  },
});
