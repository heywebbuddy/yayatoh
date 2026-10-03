import type { TenantTx } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import { isModuleKey, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_PLAN, effectiveModulesTx } from './entitlements.ts';
import {
  BILLING_PROVIDERS,
  type BillingProvider,
  EntitlementsEvent,
  LIVE_SUBSCRIPTION_STATUSES,
  SubscriptionEvent,
} from './provider/port.ts';
import {
  billingProviderEvents,
  orgBilling,
  orgEntitlements,
  orgPlans,
  planModules,
  planPrices,
  subscriptions,
} from './schema.ts';

/** Statuses after which the subscription is over: a non-grandfathered org returns to the default plan. */
const ENDED = new Set(['canceled', 'incomplete_expired']);

export type BillingEventOutcome = 'applied' | 'duplicate' | 'stale' | 'unknown_customer';

/** The org's billing row (one per org), or null. */
async function billingRowTx(tx: TenantTx) {
  const [row] = await tx.select().from(orgBilling);
  return row ?? null;
}

async function entitlementSetTx(tx: TenantTx): Promise<string[]> {
  const rows = await tx.select({ k: orgEntitlements.moduleKey }).from(orgEntitlements);
  return rows.map((r) => r.k).sort();
}

/**
 * Apply one verified provider webhook to the org it belongs to (M6.6a). Deduplicated by the
 * provider's event id; an event older than what the org already has is skipped (`stale`), so
 * retries and out-of-order deliveries never roll a plan back. Subscription events record the
 * subscription and, unless the org's legacy fees are grandfathered, move the org's fee plan
 * (`org_plans`) with it; entitlement summaries replace the org's synced module keys. Module checks
 * read those keys (`effectiveModulesTx`), so a plan change needs no feature-code change.
 */
export const applyBillingEventCommand = tenantCommand({
  name: 'billing.applyProviderEvent',
  input: z.discriminatedUnion('kind', [SubscriptionEvent, EntitlementsEvent]),
  output: z.object({
    outcome: z.enum(['applied', 'duplicate', 'stale', 'unknown_customer']),
    modules: z.array(z.string()),
  }),
  entitlement: null,
  permission: 'platform:billing.webhook',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const account = await billingRowTx(tx);
    const done = async (outcome: BillingEventOutcome) => ({
      outcome,
      modules: [...(await effectiveModulesTx(tx))].sort(),
    });
    if (!account || account.provider !== input.provider || account.providerCustomerId !== input.customerId)
      return done('unknown_customer');
    const claimed = await tx
      .insert(billingProviderEvents)
      .values({ orgId, provider: input.provider, providerEventId: input.id, type: input.type })
      .onConflictDoNothing()
      .returning({ id: billingProviderEvents.id });
    if (claimed.length === 0) return done('duplicate');

    if (input.kind === 'subscription') {
      const [prior] = await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.provider, input.provider),
            eq(subscriptions.providerSubscriptionId, input.subscriptionId),
          ),
        );
      if (prior && prior.lastEventAt > input.createdAt) return done('stale');
      const [price] = input.priceLookupKey
        ? await tx
            .select({ planKey: planPrices.planKey })
            .from(planPrices)
            .where(eq(planPrices.lookupKey, input.priceLookupKey))
        : [];
      const planKey = price?.planKey ?? null;
      const values = {
        status: input.status,
        planKey,
        priceLookupKey: input.priceLookupKey,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        lastEventAt: input.createdAt,
        providerCustomerId: input.customerId,
      };
      await tx
        .insert(subscriptions)
        .values({ orgId, provider: input.provider, providerSubscriptionId: input.subscriptionId, ...values })
        .onConflictDoUpdate({
          target: [subscriptions.orgId, subscriptions.provider, subscriptions.providerSubscriptionId],
          set: { ...values, updatedAt: ctx.now },
        });
      // The fee plan follows the subscription unless the org keeps its legacy per-ticket fees.
      if (!account.legacyFeesGrandfathered) {
        if (ENDED.has(input.status)) await tx.delete(orgPlans);
        else if (planKey && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(input.status))
          await tx
            .insert(orgPlans)
            .values({ orgId, planKey })
            .onConflictDoUpdate({
              target: orgPlans.orgId,
              set: { planKey, startedAt: ctx.now, updatedAt: ctx.now },
            });
      }
      emit({
        type: 'billing.subscription_changed',
        version: 1,
        aggregateType: 'organization',
        aggregateId: orgId,
        payload: { orgId, status: input.status, planKey, grandfathered: account.legacyFeesGrandfathered },
      });
      return done('applied');
    }

    // Entitlement summary: the full set of the customer's active features (module keys).
    if (account.entitlementsSyncedAt && account.entitlementsSyncedAt > input.createdAt) return done('stale');
    const before = await entitlementSetTx(tx);
    const next: string[] = [...new Set(input.features.filter(isModuleKey))].sort();
    await tx.delete(orgEntitlements);
    if (next.length)
      await tx
        .insert(orgEntitlements)
        .values(next.map((moduleKey) => ({ orgId, moduleKey, provider: input.provider })));
    await tx
      .update(orgBilling)
      .set({ entitlementsSyncedAt: input.createdAt, updatedAt: ctx.now })
      .where(eq(orgBilling.id, account.id));
    emit({
      type: 'billing.entitlements_synced',
      version: 1,
      aggregateType: 'organization',
      aggregateId: orgId,
      payload: {
        orgId,
        added: next.filter((k) => !before.includes(k)),
        removed: before.filter((k) => !next.includes(k)),
      },
    });
    return done('applied');
  },
  audit: (input, result) => ({
    action: 'billing.provider_event',
    targetType: 'billing_event',
    targetId: input.id,
    data: { kind: input.kind, type: input.type, outcome: result.outcome },
  }),
});

/**
 * Record the org's billing customer (created through the provider first, see
 * `ensureBillingCustomer`). Idempotent for the same customer; a different one is refused.
 */
export const linkBillingCustomerCommand = tenantCommand({
  name: 'billing.linkCustomer',
  input: z.object({
    provider: z.enum(BILLING_PROVIDERS),
    customerId: z.string().trim().min(1).max(255),
  }),
  output: z.object({ customerId: z.string(), linked: z.boolean() }),
  entitlement: null,
  permission: 'platform:billing.link',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const row = await billingRowTx(tx);
    if (row?.providerCustomerId) {
      if (row.provider === input.provider && row.providerCustomerId === input.customerId)
        return { customerId: input.customerId, linked: false };
      throw new DomainError('conflict', 'The organization already has a billing customer');
    }
    await tx
      .insert(orgBilling)
      .values({ orgId, provider: input.provider, providerCustomerId: input.customerId })
      .onConflictDoUpdate({
        target: orgBilling.orgId,
        set: { provider: input.provider, providerCustomerId: input.customerId, updatedAt: ctx.now },
      });
    emit({
      type: 'billing.customer_linked',
      version: 1,
      aggregateType: 'organization',
      aggregateId: orgId,
      payload: { orgId, provider: input.provider },
    });
    return { customerId: input.customerId, linked: true };
  },
  audit: (input) => ({
    action: 'billing.customer_linked',
    targetType: 'billing_customer',
    targetId: input.provider,
    data: { provider: input.provider },
  }),
});

/**
 * Grandfather (or stop grandfathering) the org's legacy per-ticket fees (P6-7). Existing orgs and
 * orgs from the legacy migration are flagged automatically; this is the staff override, audited.
 */
export const setLegacyFeesCommand = tenantCommand({
  name: 'billing.setLegacyFees',
  input: z.object({ grandfathered: z.boolean(), note: z.string().trim().min(3).max(500) }),
  output: z.object({ grandfathered: z.boolean() }),
  entitlement: null,
  permission: 'platform:entitlements.manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const reason = input.grandfathered ? ('staff' as const) : null;
    await tx
      .insert(orgBilling)
      .values({ orgId, legacyFeesGrandfathered: input.grandfathered, grandfatheredReason: reason })
      .onConflictDoUpdate({
        target: orgBilling.orgId,
        set: {
          legacyFeesGrandfathered: input.grandfathered,
          grandfatheredReason: reason,
          updatedAt: ctx.now,
        },
      });
    return { grandfathered: input.grandfathered };
  },
  audit: (input) => ({
    action: 'billing.legacy_fees',
    targetType: 'legacy_fees',
    targetId: input.grandfathered ? 'grandfathered' : 'standard',
    data: { grandfathered: input.grandfathered, note: input.note },
  }),
});

const BillingAccountDto = z.object({
  provider: z.enum(BILLING_PROVIDERS).nullable(),
  customerId: z.string().nullable(),
});

/** The org's billing customer, if any (system callers: the webhook and `ensureBillingCustomer`). */
export const billingAccountQuery = tenantQuery({
  name: 'billing.account',
  input: z.object({}),
  output: BillingAccountDto,
  entitlement: null,
  permission: 'platform:billing.link',
  handler: async ({ tx }) => {
    const row = await billingRowTx(tx);
    return {
      provider: (row?.provider as (typeof BILLING_PROVIDERS)[number] | null) ?? null,
      customerId: row?.providerCustomerId ?? null,
    };
  },
});

/**
 * Make sure the org has a billing customer: created through the provider (idempotency key per
 * org, so a retry reuses it) and then linked. `ctx` is a system context for the org.
 */
export async function ensureBillingCustomer(
  provider: BillingProvider,
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
): Promise<string> {
  const orgId = requireOrg(ctx);
  const current = await executeQuery(billingAccountQuery, {}, ctx, ports);
  if (current.customerId && current.provider === provider.name) return current.customerId;
  const { customerId } = await provider.createCustomer({
    orgId,
    idempotencyKey: `billing-customer:${orgId}`,
  });
  await executeCommand(linkBillingCustomerCommand, { provider: provider.name, customerId }, ctx, ports);
  return customerId;
}

/** Subscriptions of the org (newest event first), for the plan page. */
export async function subscriptionsTx(tx: TenantTx) {
  const rows = await tx.select().from(subscriptions);
  return rows.sort((a, b) => b.lastEventAt.getTime() - a.lastEventAt.getTime());
}

/**
 * Batch 3l merge: the org's plan subscriptions whose payment is failing (the alert engine's
 * `billingPastDue` rule): counts only.
 */
export async function subscriptionPaymentProblemsTx(
  tx: TenantTx,
): Promise<{ pastDue: number; unpaid: number }> {
  const [r] = await tx
    .select({
      pastDue: sql<number>`count(*) filter (where ${subscriptions.status} = 'past_due')::int`,
      unpaid: sql<number>`count(*) filter (where ${subscriptions.status} = 'unpaid')::int`,
    })
    .from(subscriptions);
  return { pastDue: r?.pastDue ?? 0, unpaid: r?.unpaid ?? 0 };
}

/** The org's fee plan key (what `feeScheduleTx` charges), defaulting to the legacy plan. */
export async function feePlanKeyTx(tx: TenantTx): Promise<string> {
  const [row] = await tx.select({ planKey: orgPlans.planKey }).from(orgPlans);
  return row?.planKey ?? DEFAULT_PLAN;
}

/** Module keys of the given plans (reference data). */
export async function planModulesOf(tx: TenantTx, planKeys: readonly string[]) {
  if (planKeys.length === 0) return new Map<string, string[]>();
  const rows = await tx
    .select({ planKey: planModules.planKey, moduleKey: planModules.moduleKey })
    .from(planModules)
    .where(inArray(planModules.planKey, [...planKeys]));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.planKey, [...(out.get(r.planKey) ?? []), r.moduleKey].sort());
  return out;
}
