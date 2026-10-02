import { fakePaymentProvider, processFakeBalanceStore } from './fake.ts';
import type { PaymentProvider } from './port.ts';
import { isSandboxOrg } from '@yayatoh/tenancy';
import { type SandboxCheck, sandboxSafeProvider } from './sandbox.ts';
import { stripePaymentProvider } from './stripe.ts';

/**
 * The deployment's payment provider, from its environment. `PAYMENTS_PROVIDER` chooses it
 * explicitly (default `fake`), so adding Stripe test keys to an environment never silently
 * switches the dev personas and e2e suites off the fake hosted pages.
 *
 * M6.3a: with Stripe, sandbox orgs still get the fake provider (`sandboxSafeProvider`), and get
 * none at all (a refusal) when no `FAKE_PAYMENTS_SECRET` is set: they never take real money.
 */
export function paymentProviderFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  appOrigin: string,
  opts: { isSandboxOrg?: SandboxCheck } = {},
): PaymentProvider {
  const which = env.PAYMENTS_PROVIDER || 'fake';
  if (which === 'stripe') {
    const secretKey = env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error('PAYMENTS_PROVIDER=stripe needs STRIPE_SECRET_KEY');
    const webhookSecrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
      (s): s is string => Boolean(s),
    );
    if (webhookSecrets.length === 0)
      throw new Error(
        'PAYMENTS_PROVIDER=stripe needs STRIPE_WEBHOOK_SECRET (and STRIPE_CONNECT_WEBHOOK_SECRET)',
      );
    const fakeSecret = env.FAKE_PAYMENTS_SECRET;
    return sandboxSafeProvider({
      live: stripePaymentProvider({ secretKey, webhookSecrets }),
      fake: fakeSecret ? fakePaymentProvider({ secret: fakeSecret, appOrigin, store: processFakeBalanceStore() }) : null,
      isSandboxOrg: opts.isSandboxOrg ?? isSandboxOrg,
    });
  }
  if (which === 'fake') {
    const secret = env.FAKE_PAYMENTS_SECRET;
    if (!secret)
      throw new Error('No payment provider configured (FAKE_PAYMENTS_SECRET, or PAYMENTS_PROVIDER=stripe)');
    return fakePaymentProvider({ secret, appOrigin, store: processFakeBalanceStore() });
  }
  throw new Error(`Unknown PAYMENTS_PROVIDER "${which}" (fake or stripe)`);
}
