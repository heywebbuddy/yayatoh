import 'server-only';
import { fakePaymentProvider, type PaymentProvider } from '@yayatoh/payments';

let provider: PaymentProvider | undefined;

/**
 * The payment provider for this deployment. Stripe arrives with the owner's account (M1.5e);
 * until then dev, preview and CI use the fake provider, which refuses to run in production.
 */
export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    const secret = process.env.FAKE_PAYMENTS_SECRET;
    if (!secret)
      throw new Error(
        'No payment provider configured (FAKE_PAYMENTS_SECRET for dev/preview; Stripe in M1.5e)',
      );
    provider = fakePaymentProvider({
      secret,
      appOrigin: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    });
  }
  return provider;
}
