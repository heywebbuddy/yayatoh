import 'server-only';
import { type PaymentProvider, paymentProviderFromEnv } from '@yayatoh/payments';

let provider: PaymentProvider | undefined;

/**
 * The payment provider for this deployment: `PAYMENTS_PROVIDER=stripe` with the Stripe keys
 * (M1.5e), otherwise the fake provider for dev, preview and CI (refused in production).
 */
export function getPaymentProvider(): PaymentProvider {
  provider ??= paymentProviderFromEnv(process.env, process.env.BETTER_AUTH_URL ?? 'http://localhost:3000');
  return provider;
}
