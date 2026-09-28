import 'server-only';
import {
  type CheckoutRiskProvider,
  type PaymentProvider,
  paymentProviderFromEnv,
  rulesRiskProvider,
} from '@yayatoh/payments';

let provider: PaymentProvider | undefined;

/**
 * The payment provider for this deployment: `PAYMENTS_PROVIDER=stripe` with the Stripe keys
 * (M1.5e), otherwise the fake provider for dev, preview and CI (refused in production).
 */
export function getPaymentProvider(): PaymentProvider {
  provider ??= paymentProviderFromEnv(process.env, process.env.BETTER_AUTH_URL ?? 'http://localhost:3000');
  return provider;
}

let risk: CheckoutRiskProvider | undefined;

/**
 * Pre-checkout risk rules (M1.6e): the local rules adapter (block/review by velocity or a country
 * mismatch). Stripe Radar still scores the card at payment time on either funds flow.
 */
export function getCheckoutRisk(): CheckoutRiskProvider {
  risk ??= rulesRiskProvider();
  return risk;
}
