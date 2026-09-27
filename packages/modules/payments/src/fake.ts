import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { CreatePaymentInput, PaymentProvider, ProviderEvent } from './port.ts';

/**
 * Fake provider for dev, preview and CI (no Stripe account yet — owner inbox). Payments are
 * "completed" on a hosted fake page that posts an HMAC-signed webhook, so the real webhook path
 * (raw-body verification, dedupe, fulfilment) is exercised end to end.
 */
export function fakePaymentProvider(opts: { secret: string; appOrigin: string }): PaymentProvider {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The fake payment provider is not allowed in production');
  if (opts.secret.length < 32) throw new Error('fake provider secret must be ≥32 chars');
  return {
    name: 'fake',
    async createPayment(i: CreatePaymentInput) {
      // Deterministic per idempotency key: a retried create returns the same payment.
      const providerPaymentId = `fakepi_${createHmac('sha256', opts.secret).update(i.idempotencyKey).digest('hex').slice(0, 24)}`;
      const params = new URLSearchParams({
        pi: providerPaymentId,
        org: i.orgId,
        order: i.orderId,
        amount: String(i.amount.amount),
        currency: i.amount.currency,
        return: i.returnUrl,
      });
      return { providerPaymentId, redirectUrl: `${opts.appOrigin}/checkout/fake?${params}` };
    },
    async verifyWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent> {
      const sig = headers.get('x-fake-signature') ?? '';
      const expected = createHmac('sha256', opts.secret).update(rawBody).digest('hex');
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid fake webhook signature');
      const e = JSON.parse(rawBody) as ProviderEvent;
      return { ...e, provider: 'fake' };
    },
  };
}

/** Build and sign a fake webhook (used by the fake hosted page and by tests). */
export function signFakeWebhook(
  secret: string,
  e: Omit<ProviderEvent, 'provider' | 'id'> & { id?: string },
): { body: string; signature: string } {
  const body = JSON.stringify({ id: e.id ?? `fakeevt_${randomUUID()}`, ...e, provider: 'fake' });
  return { body, signature: createHmac('sha256', secret).update(body).digest('hex') };
}
