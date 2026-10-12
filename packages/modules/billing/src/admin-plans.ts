import { withoutTenant } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { isModuleKey, tenantCommand } from '@yayatoh/platform';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PLAN_KEY_PATTERN } from './catalog.ts';
import { LIVE_SUBSCRIPTION_STATUSES, type ProviderCatalog } from './provider/port.ts';
import { orgPlans, planCatalog, planModules, planPrices, plans, subscriptions } from './schema.ts';

export const AdminPlanInput = z.object({
  key: z
    .string()
    .regex(PLAN_KEY_PATTERN)
    .refine((key) => key !== 'launch_standard'),
  name: z.string().trim().min(1).max(100),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
  productId: z.string().trim().max(200).nullable(),
  modules: z
    .array(z.string().refine(isModuleKey))
    .min(1)
    .refine((keys) => keys.includes('core')),
  prices: z
    .array(
      z.object({
        lookupKey: z.string().regex(/^[a-z0-9][a-z0-9_]{2,80}$/),
        currency: z.string().regex(/^[A-Z]{3}$/),
        interval: z.enum(['month', 'year']),
        unitAmountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
        active: z.boolean(),
        priceId: z.string().trim().max(200).nullable(),
      }),
    )
    .min(1)
    .max(20)
    .refine((prices) => new Set(prices.map((p) => p.lookupKey)).size === prices.length),
});

/** The development provider reads the same persisted catalog the organizer sees. */
export async function persistedBillingCatalog(): Promise<ProviderCatalog> {
  return withoutTenant(async (tx) => {
    const catalog = await tx.select().from(planCatalog);
    const names = await tx.select().from(plans);
    const modules = await tx.select().from(planModules);
    const prices = await tx.select().from(planPrices);
    return {
      products: catalog.map((p) => ({
        id: p.providerProductId ?? `localprod_${p.planKey}`,
        planKey: p.planKey,
        name: names.find((n) => n.key === p.planKey)?.name ?? p.planKey,
        active: p.active,
        sortOrder: p.sortOrder,
        features: modules.filter((m) => m.planKey === p.planKey).map((m) => m.moduleKey),
      })),
      prices: prices.map((p) => ({
        id: p.providerPriceId ?? `localprice_${p.lookupKey}`,
        productId:
          catalog.find((c) => c.planKey === p.planKey)?.providerProductId ?? `localprod_${p.planKey}`,
        lookupKey: p.lookupKey,
        currency: p.currency,
        interval: p.billingInterval as 'month' | 'year',
        unitAmountMinor: p.unitAmountMinor,
        active: p.active,
      })),
      features: [...new Set(modules.map((m) => m.moduleKey))].map((key) => ({
        id: `localfeat_${key}`,
        lookupKey: key,
        active: true,
      })),
    };
  });
}

/** Assign an included plan. Paid subscriptions must change through their provider. */
export const assignOrganizationPlanCommand = tenantCommand({
  name: 'billing.assignOrganizationPlan',
  input: z.object({ planKey: z.string().regex(PLAN_KEY_PATTERN), reason: z.string().trim().min(3).max(500) }),
  output: z.object({ planKey: z.string() }),
  entitlement: null,
  permission: 'platform:entitlements.manage',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    // Serialize with subscription webhook processing and another assignment.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);
    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES, 'unpaid', 'incomplete', 'paused']))
      .limit(1);
    if (subscription)
      throw new DomainError('invalid_state', 'Change the subscribed plan through billing', {
        reason: 'subscription_managed',
      });
    const [plan] = await tx.select().from(plans).where(eq(plans.key, input.planKey));
    if (!plan) throw new DomainError('not_found', 'Plan not found');
    await tx
      .insert(orgPlans)
      .values({ orgId, planKey: input.planKey })
      .onConflictDoUpdate({
        target: orgPlans.orgId,
        set: { planKey: input.planKey, startedAt: ctx.now },
      });
    emit({
      type: 'billing.plan_assigned',
      version: 1,
      aggregateType: 'organization',
      aggregateId: orgId,
      payload: { orgId, planKey: input.planKey },
    });
    return { planKey: input.planKey };
  },
  audit: (input) => ({
    action: 'billing.plan_assigned',
    targetType: 'plan',
    targetId: input.planKey,
    data: { reason: input.reason },
  }),
});
