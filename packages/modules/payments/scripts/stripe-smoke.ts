import { randomUUID } from 'node:crypto';
import { paymentProviderFromEnv } from '../src/config.ts';

/**
 * Live smoke test against Stripe TEST mode (M1.5e). Not part of CI: run it by hand in an
 * environment that has the Stripe test keys and network access to api.stripe.com:
 *   PAYMENTS_PROVIDER=stripe pnpm --filter @yayatoh/payments stripe:smoke
 * It creates a platform Checkout Session, a connected account with an onboarding link and a
 * direct-charge session when the account can take charges, then prints what to open. Live keys
 * are refused by the adapter outside production.
 */
const env = { ...process.env, PAYMENTS_PROVIDER: 'stripe' };
env.STRIPE_WEBHOOK_SECRET ||= 'whsec_smoke_not_used_for_outbound_calls';
if (!env.STRIPE_SECRET_KEY?.match(/^(sk|rk)_test_/))
  throw new Error('Set a Stripe TEST key in STRIPE_SECRET_KEY');
const provider = paymentProviderFromEnv(env, 'http://localhost:3000');
const orgId = randomUUID();
const orderId = randomUUID();

const platform = await provider.createPayment({
  orgId,
  orderId,
  amount: { amount: 1250, currency: 'USD' },
  fundsFlow: 'platform_mor',
  connectedAccountId: null,
  applicationFee: { amount: 0, currency: 'USD' },
  buyerEmail: 'smoke@example.test',
  description: 'Yayatoh smoke test',
  idempotencyKey: `smoke:${orderId}`,
  returnUrl: 'http://localhost:3000/orders/smoke',
});
console.info('platform_mor Checkout Session:', platform.providerPaymentId);
console.info('  pay with 4242 4242 4242 4242 at', platform.redirectUrl);

const { accountId } = await provider.createConnectedAccount({
  orgId,
  country: 'US',
  email: 'smoke-org@example.test',
});
const link = await provider.createOnboardingLink({
  orgId,
  accountId,
  returnUrl: 'http://localhost:3000/payouts?onboarding=returned',
  refreshUrl: 'http://localhost:3000/payouts?onboarding=refresh',
});
console.info('connected account:', accountId);
console.info('  onboarding (test data) at', link.url);
console.info('Done. Delete the test account in the Stripe dashboard when finished.');
