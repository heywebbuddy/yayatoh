import { describe, expect, it } from 'vitest';
import { paymentProviderFromEnv } from '../src/index.ts';

const FAKE = 'fake-secret-0123456789abcdef0123456789';

describe('payment provider from the environment', () => {
  it('defaults to the fake provider, even when Stripe keys are present', () => {
    expect(paymentProviderFromEnv({ FAKE_PAYMENTS_SECRET: FAKE }, 'http://x').name).toBe('fake');
    expect(
      paymentProviderFromEnv(
        { FAKE_PAYMENTS_SECRET: FAKE, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' },
        'http://x',
      ).name,
    ).toBe('fake');
  });

  it('uses Stripe only when chosen, and needs its key and a webhook secret', () => {
    expect(
      paymentProviderFromEnv(
        {
          PAYMENTS_PROVIDER: 'stripe',
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_c',
        },
        'http://x',
      ).name,
    ).toBe('stripe');
    expect(() =>
      paymentProviderFromEnv({ PAYMENTS_PROVIDER: 'stripe', STRIPE_WEBHOOK_SECRET: 'whsec_x' }, 'http://x'),
    ).toThrow(/STRIPE_SECRET_KEY/);
    expect(() =>
      paymentProviderFromEnv({ PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x' }, 'http://x'),
    ).toThrow(/WEBHOOK_SECRET/);
  });

  it('refuses a missing fake secret and unknown providers', () => {
    expect(() => paymentProviderFromEnv({}, 'http://x')).toThrow(/FAKE_PAYMENTS_SECRET/);
    expect(() => paymentProviderFromEnv({ PAYMENTS_PROVIDER: 'paypal' }, 'http://x')).toThrow(
      /Unknown PAYMENTS_PROVIDER/,
    );
  });
});
