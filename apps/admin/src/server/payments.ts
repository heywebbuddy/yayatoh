import 'server-only';
import { type PaymentProvider, paymentProviderFromEnv } from '@yayatoh/payments';
import { gotenbergRenderer, type PdfRenderer } from '@yayatoh/pdf';

let provider: PaymentProvider | undefined;
let renderer: PdfRenderer | null | undefined;

/**
 * The payment provider for this deployment: `PAYMENTS_PROVIDER=stripe` with the Stripe keys
 * (M1.5e), otherwise the fake provider for dev, preview and CI (refused in production).
 */
export function getPaymentProvider(): PaymentProvider {
  provider ??= paymentProviderFromEnv(process.env, process.env.BETTER_AUTH_URL ?? 'http://localhost:3000');
  return provider;
}

/** The PDF renderer (ADR 0017), or null without GOTENBERG_URL (documents are then HTML). */
export function getPdfRenderer(): PdfRenderer | null {
  if (renderer === undefined)
    renderer = process.env.GOTENBERG_URL ? gotenbergRenderer({ url: process.env.GOTENBERG_URL }) : null;
  return renderer;
}
