'use server';

import { FAKE_TEST_CARDS, type FakeTestCard, signFakeSetupWebhook } from '@yayatoh/payments';
import { redirect } from 'next/navigation';

/**
 * The fake hosted card step's buttons (M4.8e): post a signed setup webhook (the chosen test card)
 * to our own endpoint, then return. Dev/preview/CI only.
 */
export async function completeFakeSetup(
  params: { seti: string; org: string; ref: string; acct: string; email: string; returnUrl: string },
  outcome: 'succeeded' | 'failed',
  form: FormData,
): Promise<void> {
  const secret = process.env.FAKE_PAYMENTS_SECRET;
  if (!secret || process.env.VERCEL_ENV === 'production') throw new Error('fake payments are disabled');
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const picked = String(form.get('card') ?? '4242');
  const card = (Object.hasOwn(FAKE_TEST_CARDS, picked) ? picked : '4242') as FakeTestCard;
  const { body, signature } = signFakeSetupWebhook(secret, {
    orgId: params.org,
    reference: params.ref,
    providerSetupId: params.seti,
    connectedAccountId: params.acct,
    email: params.email,
    outcome,
    card,
  });
  await fetch(`${origin}/api/webhooks/fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    body,
  });
  const back = new URL(params.returnUrl, origin);
  redirect(back.origin === new URL(origin).origin ? `${back.pathname}${back.search}` : '/');
}
