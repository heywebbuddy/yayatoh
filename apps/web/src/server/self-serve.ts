import 'server-only';
import { assignOrganizationPlanCommand, billingEnabled, startPlanCheckout } from '@yayatoh/billing';
import { createCtx, executeCommand, isProductionEnv } from '@yayatoh/kernel';
import { myOrganizations } from '@yayatoh/tenancy';
import { getBillingProvider } from '@/server/billing.ts';
import { ports } from '@/server/ports.ts';

/** The public origin of this app (the checkout sends people back here). */
export const appOrigin = () =>
  (process.env.NEXT_PUBLIC_APP_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  );

/** The org (by address) if this person is a member, else null: the sign-up payment pages never reveal other orgs. */
export async function myOrgBySlug(userId: string, slug: string) {
  return (await myOrganizations(userId)).find((o) => o.slug === slug) ?? null;
}

/** Put an organization on a plan that needs no payment (the free plan), as the platform. */
export async function assignFreePlan(orgId: string, planKey: string): Promise<void> {
  await executeCommand(
    assignOrganizationPlanCommand,
    { planKey, reason: 'self-serve sign-up' },
    createCtx({ orgId, actor: { type: 'system', name: 'self-serve-signup' } }),
    ports,
  );
}

/**
 * The provider's hosted checkout for an organization's chosen plan. The org's plan is not touched
 * here: it changes when the provider's webhook says the payment succeeded.
 */
export async function checkoutFor(i: {
  orgId: string;
  slug: string;
  email: string;
  planKey: string;
  interval: 'month' | 'year';
}): Promise<string> {
  if (!billingEnabled()) throw new Error('billing_off');
  const origin = appOrigin();
  const q = new URLSearchParams({ org: i.slug, plan: i.planKey, interval: i.interval });
  const { url } = await startPlanCheckout({
    provider: getBillingProvider(),
    ctx: createCtx({ orgId: i.orgId, actor: { type: 'system', name: 'self-serve-signup' } }),
    ports,
    planKey: i.planKey,
    interval: i.interval,
    successUrl: `${origin}/signup/welcome?${q}`,
    cancelUrl: `${origin}/signup/pay?${q}&cancelled=1`,
    email: i.email,
  });
  return url;
}

/** The fake checkout's secret, only while the fake provider is the billing provider outside production. */
export function fakeCheckoutSecret(): string | null {
  if (!billingEnabled() || isProductionEnv()) return null;
  if (process.env.BILLING_PROVIDER && process.env.BILLING_PROVIDER !== 'fake') return null;
  return process.env.FAKE_PAYMENTS_SECRET ?? null;
}
