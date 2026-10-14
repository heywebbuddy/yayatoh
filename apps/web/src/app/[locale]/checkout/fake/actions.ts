'use server';

import { isProductionEnv } from '@yayatoh/kernel';
import { signFakeWebhook } from '@yayatoh/payments';
import { redirect } from 'next/navigation';
import { fakeReturnTarget } from '@/lib/app-links.ts';

/** The fake hosted page's buttons: post a signed webhook to our own endpoint, then return. */
export async function completeFakePayment(
  params: {
    pi: string;
    org: string;
    order: string;
    amount: string;
    currency: string;
    returnUrl: string;
    fee?: string;
    acct?: string;
  },
  outcome: 'succeeded' | 'failed',
): Promise<void> {
  const secret = process.env.FAKE_PAYMENTS_SECRET;
  if (!secret || isProductionEnv()) throw new Error('fake payments are disabled');
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const { body, signature } = signFakeWebhook(secret, {
    type: outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
    providerPaymentId: params.pi,
    amountMinor: Number(params.amount),
    currency: params.currency,
    orgId: params.org,
    orderId: params.order,
    ...(params.fee !== undefined ? { applicationFeeMinor: Number(params.fee) } : {}),
    ...(params.acct ? { connectedAccountId: params.acct } : {}),
  });
  await fetch(`${origin}/api/webhooks/fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    body,
  });
  // Only same-origin return URLs, and the universal links of the mobile apps (M7.2f: the app's
  // checkout returns to `https://app.yayatoh.com/events/…`, which the app opens).
  redirect(fakeReturnTarget(params.returnUrl, origin));
}
