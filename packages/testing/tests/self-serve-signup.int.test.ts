import {
  currentPlanKey,
  fakeBillingProvider,
  fakeCheckoutSignature,
  persistedBillingCatalog,
  processBillingWebhook,
  selfServePrice,
  startPlanCheckout,
} from '@yayatoh/billing';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createCtx, uuidv7 } from '@yayatoh/kernel';
import { openSignupEnabled, signUpOrganization } from '@yayatoh/tenancy';
import { ports } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const admin = adminClient();
const SECRET = 'self-serve-signup-test-secret-0123456789';
let openBefore = false;

/** The fake provider with its webhooks handed to our own webhook processor, as the web app wires it. */
const provider = fakeBillingProvider({
  secret: SECRET,
  catalog: persistedBillingCatalog,
  deliver: async (d) => {
    const out = await processBillingWebhook(d.body, new Headers(d.headers), 'fake', {
      provider: () => provider,
      ports,
      enabled: true,
    });
    if (out.status !== 200) throw new Error(`webhook ${out.status}`);
  },
});

const person = () => createCtx({ actor: { type: 'user', userId: uuidv7() } });
const sys = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'test' } });
const slug = (p: string) => `${p}-${uuidv7().slice(-8)}`;
const base = { defaultProfile: 'conference', acceptTerms: true } as const;

beforeAll(async () => {
  const [flag] = await admin`select enabled from platform.flags where key = 'open_signup'`;
  openBefore = flag?.enabled === true;
  await admin`insert into platform.flags (key, enabled, updated_by) values ('open_signup', true, 'staff:test')
    on conflict (key) do update set enabled = true`;
  // The plans staff switch on in Plans & billing: Free and Pro on, Starter off.
  await admin`update billing.plan_catalog set active = true where plan_key in ('tier_free', 'tier_pro')`;
  await admin`update billing.plan_catalog set active = false where plan_key = 'tier_starter'`;
  await admin`update billing.plan_prices set active = true where plan_key in ('tier_free', 'tier_pro', 'tier_starter')`;
});
afterAll(async () => {
  await admin`update platform.flags set enabled = ${openBefore} where key = 'open_signup'`;
  await admin.end();
  await closePools();
});

describe('self-serve sign-up: plan → account → pay → org on the plan', () => {
  it('sells only what staff switched on, by interval; free and custom plans have no checkout', async () => {
    expect(await selfServePrice('tier_pro', 'month')).toMatchObject({
      lookupKey: 'tier_pro_month_usd',
      free: false,
    });
    expect(await selfServePrice('tier_pro', 'year')).toMatchObject({ lookupKey: 'tier_pro_year_usd' });
    expect(await selfServePrice('tier_free', 'month')).toMatchObject({ free: true });
    expect(await selfServePrice('tier_starter', 'month')).toBeNull();
    expect(await selfServePrice('tier_enterprise', 'year')).toBeNull();
    expect(await selfServePrice('launch_standard', 'month')).toBeNull();
  });

  it('open sign-up creates a limited org with no code; paying (fake) switches the plan on through the webhook only', async () => {
    expect(await openSignupEnabled()).toBe(true);
    const owner = person();
    const org = await signUpOrganization(owner, { ...base, slug: slug('acme'), name: 'Acme Events' }, ports);
    expect(org.status).toBe('limited');
    expect(await currentPlanKey(org.id)).not.toBe('tier_pro');

    const { url, price } = await startPlanCheckout({
      provider,
      ctx: sys(org.id),
      ports,
      planKey: 'tier_pro',
      interval: 'month',
      successUrl: 'http://localhost:3200/signup/welcome?org=acme',
      cancelUrl: 'http://localhost:3200/signup/pay?org=acme&cancelled=1',
      email: 'owner@acme.example',
    });
    expect(price.lookupKey).toBe('tier_pro_month_usd');
    const q = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe('/signup/pay/fake');
    expect(q.get('sig')).toBe(
      fakeCheckoutSignature(SECRET, {
        customerId: q.get('customer') as string,
        priceLookupKey: 'tier_pro_month_usd',
        successUrl: q.get('ok') as string,
        cancelUrl: q.get('no') as string,
      }),
    );
    // Starting a checkout, or walking away from it, changes nothing.
    expect(await currentPlanKey(org.id)).not.toBe('tier_pro');

    // "Pay" on the fake page: the provider activates the subscription and its webhooks arrive.
    await provider.changePlan({
      customerId: q.get('customer') as string,
      subscription: null,
      priceLookupKey: 'tier_pro_month_usd',
      at: new Date(),
      coupon: null,
      idempotencyKey: `test:${org.id}`,
    });
    expect(await currentPlanKey(org.id)).toBe('tier_pro');
  });

  it('a forged or replayed webhook does not put an org on a plan', async () => {
    const owner = person();
    const org = await signUpOrganization(owner, { ...base, slug: slug('forge'), name: 'Forge Co' }, ports);
    const bad = await processBillingWebhook(
      JSON.stringify({ kind: 'subscription', provider: 'fake', id: 'evt_forged' }),
      new Headers({ 'x-fake-billing-signature': 'nope' }),
      'fake',
      { provider: () => provider, ports, enabled: true },
    );
    expect(bad.status).toBe(400);
    expect(await currentPlanKey(org.id)).not.toBe('tier_pro');
  });

  it('free and unavailable plans cannot be checked out; sign-up closes with the switch', async () => {
    const org = await signUpOrganization(person(), { ...base, slug: slug('free'), name: 'Free Org' }, ports);
    const args = {
      provider,
      ctx: sys(org.id),
      ports,
      interval: 'month' as const,
      successUrl: 'http://localhost:3200/a',
      cancelUrl: 'http://localhost:3200/b',
      email: null,
    };
    await expect(startPlanCheckout({ ...args, planKey: 'tier_free' })).rejects.toMatchObject({
      details: { reason: 'not_purchasable' },
    });
    await expect(startPlanCheckout({ ...args, planKey: 'tier_starter' })).rejects.toMatchObject({
      details: { reason: 'not_purchasable' },
    });
    await admin`update platform.flags set enabled = false where key = 'open_signup'`;
    await expect(
      signUpOrganization(person(), { ...base, slug: slug('closed'), name: 'Closed Co' }, ports),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'signup_closed' } });
    await admin`update platform.flags set enabled = true where key = 'open_signup'`;
  });
});
