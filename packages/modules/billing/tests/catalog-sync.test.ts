import { describe, expect, it } from 'vitest';
import {
  billingEnabled,
  billingProviderFromEnv,
  catalogSyncPayload,
  fakeBillingCatalog,
  PLACEHOLDER_PLANS,
} from '../src/index.ts';

describe('catalog sync payload (M6.6a)', () => {
  it('maps the fake catalog onto exactly the placeholder plans, prices and modules', () => {
    const p = catalogSyncPayload(fakeBillingCatalog());
    expect(p.skipped).toEqual([]);
    expect(p.plans).toEqual(
      PLACEHOLDER_PLANS.map((x) => ({
        key: x.key,
        name: x.name,
        active: false,
        sortOrder: x.sortOrder,
        productId: `fakeprod_${x.key}`,
        modules: [...x.modules].sort(),
      })),
    );
    expect(p.prices.map((x) => x.lookupKey)).toEqual(
      PLACEHOLDER_PLANS.flatMap((x) => x.prices.map((y) => y.lookupKey)),
    );
    expect(p.prices.every((x) => !x.active)).toBe(true);
  });

  it('skips products without a usable plan key, never touches launch_standard, keeps the first duplicate', () => {
    const p = catalogSyncPayload({
      products: [
        { id: 'prod_a', planKey: null, name: 'Gift card', active: true, sortOrder: 0, features: [] },
        {
          id: 'prod_b',
          planKey: 'launch_standard',
          name: 'Legacy',
          active: true,
          sortOrder: 0,
          features: [],
        },
        { id: 'prod_c', planKey: 'Bad Key!', name: 'Bad', active: true, sortOrder: 0, features: [] },
        {
          id: 'prod_d',
          planKey: 'tier_pro',
          name: 'Pro',
          active: true,
          sortOrder: 9999,
          features: ['core', 'nope', 'core'],
        },
        { id: 'prod_e', planKey: 'tier_pro', name: 'Pro again', active: true, sortOrder: 1, features: [] },
      ],
      prices: [],
      features: [],
    });
    expect(p.plans).toEqual([
      { key: 'tier_pro', name: 'Pro', active: true, sortOrder: 1000, productId: 'prod_d', modules: ['core'] },
    ]);
    expect(p.skipped.map((s) => s.id)).toEqual(['prod_a', 'prod_b', 'prod_c', 'prod_e']);
  });

  it('keeps only recurring prices with a lookup key on a plan product, and module-key features', () => {
    const p = catalogSyncPayload({
      products: [
        { id: 'prod_p', planKey: 'tier_pro', name: 'Pro', active: true, sortOrder: 3, features: [] },
      ],
      prices: [
        {
          id: 'pr_ok',
          productId: 'prod_p',
          lookupKey: 'tier_pro_month_usd',
          currency: 'USD',
          interval: 'month',
          unitAmountMinor: 9900,
          active: true,
        },
        {
          id: 'pr_nokey',
          productId: 'prod_p',
          lookupKey: null,
          currency: 'USD',
          interval: 'month',
          unitAmountMinor: 1,
          active: true,
        },
        {
          id: 'pr_once',
          productId: 'prod_p',
          lookupKey: 'tier_pro_once',
          currency: 'USD',
          interval: null,
          unitAmountMinor: 1,
          active: true,
        },
        {
          id: 'pr_other',
          productId: 'prod_x',
          lookupKey: 'gift_usd',
          currency: 'USD',
          interval: 'month',
          unitAmountMinor: 1,
          active: true,
        },
      ],
      features: [
        { id: 'feat_1', lookupKey: 'sessions', active: true },
        { id: 'feat_2', lookupKey: 'not_a_module', active: true },
      ],
    });
    expect(p.prices).toEqual([
      {
        lookupKey: 'tier_pro_month_usd',
        planKey: 'tier_pro',
        currency: 'USD',
        interval: 'month',
        unitAmountMinor: 9900,
        active: true,
        priceId: 'pr_ok',
      },
    ]);
    expect(p.features).toEqual([{ moduleKey: 'sessions', featureId: 'feat_1', active: true }]);
    expect(p.skipped.map((s) => s.id)).toEqual(['pr_nokey', 'pr_once', 'pr_other', 'feat_2']);
  });
});

describe('billing configuration (M6.6a)', () => {
  it('is off unless BILLING_ENABLED is set to a true value', () => {
    expect(billingEnabled({})).toBe(false);
    for (const v of ['', '0', 'false', 'off', 'no', 'maybe'])
      expect(billingEnabled({ BILLING_ENABLED: v })).toBe(false);
    for (const v of ['1', 'true', 'TRUE', ' on ', 'yes'])
      expect(billingEnabled({ BILLING_ENABLED: v })).toBe(true);
  });

  it('defaults to the fake provider; Stripe only when chosen explicitly and fully configured', () => {
    const fake = 'f'.repeat(64);
    expect(billingProviderFromEnv({ FAKE_PAYMENTS_SECRET: fake, STRIPE_SECRET_KEY: 'sk_test_x' }).name).toBe(
      'fake',
    );
    expect(() => billingProviderFromEnv({})).toThrow('No billing provider configured');
    expect(() =>
      billingProviderFromEnv({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x' }),
    ).toThrow('STRIPE_BILLING_WEBHOOK_SECRET');
    expect(
      billingProviderFromEnv({
        BILLING_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_x',
      }).name,
    ).toBe('stripe');
    expect(() => billingProviderFromEnv({ BILLING_PROVIDER: 'paddle' })).toThrow('Unknown BILLING_PROVIDER');
  });
});
