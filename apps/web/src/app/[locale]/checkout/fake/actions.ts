'use server';

import { signFakeWebhook } from '@yayatoh/payments';
import { redirect } from 'next/navigation';

/** The fake hosted page's buttons: post a signed webhook to our own endpoint, then return. */
export async function completeFakePayment(
  params: { pi: string; org: string; order: string; amount: string; currency: string; returnUrl: string },
  outcome: 'succeeded' | 'failed',
): Promise<void> {
  const secret = process.env.FAKE_PAYMENTS_SECRET;
  if (!secret || process.env.VERCEL_ENV === 'production') throw new Error('fake payments are disabled');
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const { body, signature } = signFakeWebhook(secret, {
    type: outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
    providerPaymentId: params.pi,
    amountMinor: Number(params.amount),
    currency: params.currency,
    orgId: params.org,
    orderId: params.order,
  });
  await fetch(`${origin}/api/webhooks/fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    body,
  });
  // Only same-origin return URLs.
  const back = new URL(params.returnUrl, origin);
  redirect(back.origin === new URL(origin).origin ? `${back.pathname}${back.search}` : '/');
}
