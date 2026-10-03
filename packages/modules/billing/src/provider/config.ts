import { fakeBillingProvider } from './fake.ts';
import type { BillingProvider } from './port.ts';
import { stripeBillingProvider } from './stripe.ts';

export { billingEnabled } from './flag.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The deployment's billing provider. `BILLING_PROVIDER` chooses it explicitly (default `fake`), so
 * Stripe keys in an environment never switch dev and CI off the fake. The fake signs with a key
 * derived from FAKE_PAYMENTS_SECRET (no new secret to manage).
 */
export function billingProviderFromEnv(env: Env = process.env): BillingProvider {
  const which = env.BILLING_PROVIDER || 'fake';
  if (which === 'stripe') {
    const secretKey = env.STRIPE_SECRET_KEY;
    const webhookSecret = env.STRIPE_BILLING_WEBHOOK_SECRET;
    if (!secretKey || !webhookSecret)
      throw new Error('BILLING_PROVIDER=stripe needs STRIPE_SECRET_KEY and STRIPE_BILLING_WEBHOOK_SECRET');
    return stripeBillingProvider({ secretKey, webhookSecret });
  }
  if (which === 'fake') {
    const secret = env.FAKE_PAYMENTS_SECRET;
    if (!secret)
      throw new Error('No billing provider configured (FAKE_PAYMENTS_SECRET, or BILLING_PROVIDER=stripe)');
    return fakeBillingProvider({ secret });
  }
  throw new Error(`Unknown BILLING_PROVIDER "${which}" (fake or stripe)`);
}
