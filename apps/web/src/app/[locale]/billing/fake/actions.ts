'use server';

import {
  fakeBillingCatalog,
  fakePortalSignature,
  fakeSubscriptionId,
  signFakeBillingEvent,
  subscriptionOfCustomer,
} from '@yayatoh/billing';
import { redirect } from 'next/navigation';
import { testBillingSecret } from '@/server/billing.ts';

export interface PortalParams {
  readonly locale: string;
  readonly customer: string;
  readonly returnPath: string;
  readonly sig: string;
}

/** A signed link for this customer and same-origin return path, or null. */
function verified(p: PortalParams): string | null {
  const secret = testBillingSecret();
  if (!secret || !/^\/[a-z-]+\/o\/[a-z0-9-]+\/plan$/.test(p.returnPath)) return null;
  return fakePortalSignature(secret, p.customer, p.returnPath) === p.sig ? secret : null;
}

/**
 * The test billing portal's buttons (development only, M6.6a): send the webhooks the provider
 * would send for a plan change (the subscription, then the customer's entitlement summary built
 * from the product's features) to our own billing endpoint, then return to the plan page.
 */
export async function changeTestPlan(
  p: PortalParams,
  outcome: 'switch' | 'cancel',
  formData: FormData,
): Promise<void> {
  const secret = verified(p);
  if (!secret) redirect(`/${p.locale}`);
  const catalog = fakeBillingCatalog();
  const planKey = String(formData.get('plan') ?? '');
  const product = catalog.products.find((x) => x.planKey === planKey);
  if (outcome === 'switch' && !product) {
    const qs = new URLSearchParams({
      customer: p.customer,
      return: p.returnPath,
      sig: p.sig,
      error: 'choose',
    });
    redirect(`/${p.locale}/billing/fake?${qs}`);
  }
  const price =
    catalog.prices.find((x) => x.productId === product?.id && x.interval === 'month') ??
    catalog.prices.find((x) => x.productId === product?.id);
  const createdAt = new Date();
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const deliveries = [
    signFakeBillingEvent(secret, {
      kind: 'subscription',
      type: outcome === 'cancel' ? 'customer.subscription.deleted' : 'customer.subscription.updated',
      createdAt,
      customerId: p.customer,
      subscriptionId: fakeSubscriptionId(secret, p.customer),
      status: outcome === 'cancel' ? 'canceled' : 'active',
      priceLookupKey: price?.lookupKey ?? null,
      currentPeriodEnd: new Date(createdAt.getTime() + 30 * 86_400_000),
      cancelAtPeriodEnd: false,
    }),
    signFakeBillingEvent(secret, {
      kind: 'entitlements',
      type: 'entitlements.active_entitlement_summary.updated',
      createdAt,
      customerId: p.customer,
      features: outcome === 'cancel' ? [] : [...(product?.features ?? [])],
    }),
  ];
  for (const d of deliveries) {
    const res = await fetch(`${origin}/api/webhooks/billing/fake`, {
      method: 'POST',
      headers: d.headers,
      body: d.body,
    });
    if (!res.ok) throw new Error(`test billing webhook failed: ${res.status}`);
  }
  redirect(`${p.returnPath}?billing=updated`);
}

/**
 * The test billing portal's renewal buttons (development only, M6.6b): the provider's webhooks
 * for a renewal whose payment failed (`past_due`, retries continue) or after the last retry
 * (`unpaid`), sent to our billing endpoint like any other delivery.
 */
export async function simulateRenewal(p: PortalParams, outcome: 'fail' | 'give_up'): Promise<void> {
  const secret = verified(p);
  if (!secret) redirect(`/${p.locale}`);
  const current = await subscriptionOfCustomer('fake', p.customer);
  if (!current?.subscription) {
    const qs = new URLSearchParams({
      customer: p.customer,
      return: p.returnPath,
      sig: p.sig,
      error: 'nosub',
    });
    redirect(`/${p.locale}/billing/fake?${qs}`);
  }
  const sub = current.subscription;
  const d = signFakeBillingEvent(secret, {
    kind: 'subscription',
    type: outcome === 'fail' ? 'invoice.payment_failed' : 'customer.subscription.updated',
    customerId: p.customer,
    subscriptionId: sub.id,
    status: outcome === 'fail' ? 'past_due' : 'unpaid',
    priceLookupKey: sub.priceLookupKey,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: false,
  });
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const res = await fetch(`${origin}/api/webhooks/billing/fake`, {
    method: 'POST',
    headers: d.headers,
    body: d.body,
  });
  if (!res.ok) throw new Error(`test billing webhook failed: ${res.status}`);
  redirect(`${p.returnPath}?billing=renewal`);
}
