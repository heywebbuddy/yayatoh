import { createHmac } from 'node:crypto';
import { MODULE_KEYS } from '@yayatoh/platform';
import { describe, expect, it } from 'vitest';
import {
  FAKE_BILLING_SIGNATURE_HEADER,
  fakeBillingProvider,
  fakeCustomerId,
  fakeSubscriptionId,
  PLACEHOLDER_PLANS,
  signFakeBillingEvent,
} from '../src/index.ts';

const SECRET = 'a'.repeat(64);
const provider = fakeBillingProvider({ secret: SECRET });
const ORG = '0199a1b2-0000-7000-8000-000000000001';

const subscription = {
  kind: 'subscription' as const,
  type: 'customer.subscription.updated',
  customerId: 'fakecus_1',
  subscriptionId: 'fakesub_1',
  status: 'active' as const,
  priceLookupKey: 'tier_pro_month_usd',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

describe('fake billing provider (M6.6a)', () => {
  it('verifies its own signature and returns the normalized event', async () => {
    const at = new Date('2027-01-02T03:04:05Z');
    const { body, headers } = signFakeBillingEvent(SECRET, {
      ...subscription,
      id: 'fakeevt_1',
      createdAt: at,
    });
    const e = await provider.verifyWebhook(body, new Headers(headers));
    expect(e).toMatchObject({ ...subscription, id: 'fakeevt_1', provider: 'fake', createdAt: at });
  });

  it('refuses a tampered body, a missing signature and another secret', async () => {
    const { body, headers } = signFakeBillingEvent(SECRET, subscription);
    await expect(
      provider.verifyWebhook(body.replace('tier_pro', 'tier_agency'), new Headers(headers)),
    ).rejects.toThrow();
    await expect(provider.verifyWebhook(body, new Headers())).rejects.toThrow();
    const other = signFakeBillingEvent('b'.repeat(64), subscription);
    await expect(provider.verifyWebhook(other.body, new Headers(other.headers))).rejects.toThrow();
  });

  it('never accepts a body signed with the payments webhook key (domain separation)', async () => {
    const { body } = signFakeBillingEvent(SECRET, subscription);
    const paymentsSig = createHmac('sha256', SECRET).update(body).digest('hex');
    await expect(
      provider.verifyWebhook(body, new Headers({ [FAKE_BILLING_SIGNATURE_HEADER]: paymentsSig })),
    ).rejects.toThrow('invalid fake billing signature');
  });

  it('refuses a signed body that is not a billing event', async () => {
    const body = JSON.stringify({ kind: 'payment', id: 'x', provider: 'fake' });
    const sig = createHmac('sha256', createHmac('sha256', SECRET).update('billing-webhook').digest())
      .update(body)
      .digest('hex');
    await expect(
      provider.verifyWebhook(body, new Headers({ [FAKE_BILLING_SIGNATURE_HEADER]: sig })),
    ).rejects.toThrow();
  });

  it('creates one deterministic customer per org and one subscription per customer', async () => {
    const a = await provider.createCustomer({ orgId: ORG, idempotencyKey: 'k1' });
    const b = await provider.createCustomer({ orgId: ORG, idempotencyKey: 'k2' });
    expect(a).toEqual(b);
    expect(a.customerId).toBe(fakeCustomerId(SECRET, ORG));
    expect(a.customerId).toMatch(/^fakecus_[0-9a-f]{20}$/);
    expect(fakeSubscriptionId(SECRET, a.customerId)).toMatch(/^fakesub_[0-9a-f]{20}$/);
  });

  it('serves the placeholder tiers switched off, with every module key as a feature', async () => {
    const c = await provider.listCatalog();
    expect(c.products.map((p) => p.planKey)).toEqual(PLACEHOLDER_PLANS.map((p) => p.key));
    expect(c.products.every((p) => !p.active)).toBe(true);
    expect(c.prices.every((p) => !p.active)).toBe(true);
    expect(c.features.map((f) => f.lookupKey)).toEqual([...MODULE_KEYS]);
  });

  it('needs a long secret and is refused in production', () => {
    expect(() => fakeBillingProvider({ secret: 'short' })).toThrow();
    const prior = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = 'production';
    try {
      expect(() => fakeBillingProvider({ secret: SECRET })).toThrow('not allowed in production');
    } finally {
      if (prior === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prior;
    }
  });
});

describe('placeholder plans (P6-7, P6-13)', () => {
  it('are the research tiers in order, each a superset of the one below', () => {
    expect(PLACEHOLDER_PLANS.map((p) => p.name)).toEqual(['Free', 'Starter', 'Pro', 'Agency', 'Enterprise']);
    for (let i = 1; i < PLACEHOLDER_PLANS.length; i++) {
      const lower = PLACEHOLDER_PLANS[i - 1]?.modules ?? [];
      const upper = new Set(PLACEHOLDER_PLANS[i]?.modules ?? []);
      expect(lower.every((m) => upper.has(m))).toBe(true);
    }
  });
  it('price $0 / $29 / $99 / $249 a month and quote Enterprise', () => {
    const monthly = PLACEHOLDER_PLANS.map(
      (p) => p.prices.find((x) => x.interval === 'month')?.unitAmountMinor ?? null,
    );
    expect(monthly).toEqual([0, 2900, 9900, 24900, null]);
    expect(PLACEHOLDER_PLANS.at(-1)?.prices).toEqual([
      { lookupKey: 'tier_enterprise_year_usd', currency: 'USD', interval: 'year', unitAmountMinor: null },
    ]);
  });
  it('every tier carries core and only registered module keys', () => {
    for (const p of PLACEHOLDER_PLANS) {
      expect(p.modules).toContain('core');
      for (const m of p.modules) expect(MODULE_KEYS).toContain(m);
    }
  });
});
