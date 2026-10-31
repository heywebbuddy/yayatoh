import { type TenantTx, withTenant } from '@yayatoh/db';
import { type CommandPorts, type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { publicPlanTiers } from './pricing.ts';
import type { BillingProvider } from './provider/port.ts';
import { orgPlans } from './schema.ts';
import { ensureBillingCustomer } from './subscriptions.ts';

export type CheckoutInterval = 'month' | 'year';

export interface SelfServePrice {
  readonly planKey: string;
  readonly planName: string;
  readonly interval: CheckoutInterval;
  readonly currency: string;
  readonly unitAmountMinor: number;
  readonly lookupKey: string;
  /** Nothing to pay: the plan is switched on without a checkout. */
  readonly free: boolean;
}

/**
 * The price a visitor can buy by themselves: a `tier_*` plan staff have switched on in Plans &
 * billing, with an active price for the interval. Null for anything else (a plan that is off, a
 * custom-priced one such as Enterprise, an interval without a price). The sign-up page and the
 * checkout both ask here, so what is shown is exactly what can be bought.
 */
export async function selfServePrice(
  planKey: string,
  interval: CheckoutInterval,
): Promise<SelfServePrice | null> {
  const plan = (await publicPlanTiers()).find((p) => p.key === planKey);
  if (!plan?.active) return null;
  const price =
    plan.prices.find((p) => p.interval === interval && p.currency === 'USD') ??
    plan.prices.find((p) => p.interval === interval);
  if (!price) return null;
  return {
    planKey: plan.key,
    planName: plan.name,
    interval,
    currency: price.currency,
    unitAmountMinor: price.unitAmountMinor,
    lookupKey: price.lookupKey,
    free: price.unitAmountMinor === 0,
  };
}

/**
 * Start paying for a plan: make sure the organization has a billing customer, then ask the
 * provider for its hosted checkout. Nothing about the org's plan changes here: the provider's
 * webhook (`applyBillingEventCommand`, deduplicated by event id) applies it once the payment has
 * succeeded. `ctx` is a system context for the org.
 */
export async function startPlanCheckout(i: {
  provider: BillingProvider;
  ctx: Ctx;
  ports: CommandPorts<TenantTx>;
  planKey: string;
  interval: CheckoutInterval;
  successUrl: string;
  cancelUrl: string;
  email: string | null;
}): Promise<{ url: string; price: SelfServePrice }> {
  const orgId = requireOrg(i.ctx);
  const price = await selfServePrice(i.planKey, i.interval);
  if (!price || price.free)
    throw new DomainError('invalid_state', 'This plan cannot be bought online', {
      reason: 'not_purchasable',
    });
  const customerId = await ensureBillingCustomer(i.provider, i.ctx, i.ports);
  const { url } = await i.provider.startCheckout({
    customerId,
    priceLookupKey: price.lookupKey,
    successUrl: i.successUrl,
    cancelUrl: i.cancelUrl,
    orgId,
    customerEmail: i.email,
    idempotencyKey: `checkout:${orgId}:${price.lookupKey}:${Math.floor(Date.now() / 60_000)}`,
  });
  return { url, price };
}

/** The plan an organization is on right now (null: none assigned yet, the default plan applies). */
export async function currentPlanKey(orgId: string): Promise<string | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'billing.checkout' } });
  const [row] = await withTenant(ctx, (tx) => tx.select({ planKey: orgPlans.planKey }).from(orgPlans));
  return row?.planKey ?? null;
}
