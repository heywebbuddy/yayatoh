import 'server-only';
import { fakePaymentProvider, type PaymentProvider } from '@yayatoh/payments';
import { gotenbergRenderer, type PdfRenderer } from '@yayatoh/pdf';

let provider: PaymentProvider | undefined;
let renderer: PdfRenderer | null | undefined;

/** The payment provider (fake until the owner's Stripe account; refused in production). */
export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    const secret = process.env.FAKE_PAYMENTS_SECRET;
    if (!secret) throw new Error('No payment provider configured (FAKE_PAYMENTS_SECRET for dev/preview)');
    provider = fakePaymentProvider({
      secret,
      appOrigin: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    });
  }
  return provider;
}

/** The PDF renderer (ADR 0017), or null without GOTENBERG_URL (documents are then HTML). */
export function getPdfRenderer(): PdfRenderer | null {
  if (renderer === undefined)
    renderer = process.env.GOTENBERG_URL ? gotenbergRenderer({ url: process.env.GOTENBERG_URL }) : null;
  return renderer;
}
