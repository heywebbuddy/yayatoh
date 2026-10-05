'use server';

import { signFakeAccountWebhook } from '@yayatoh/payments';
import { redirect } from 'next/navigation';

/**
 * The fake onboarding page's buttons: post a signed `account.updated` webhook to our own
 * endpoint (the only way account state changes), then return to the console.
 */
export async function completeFakeOnboarding(
  params: { acct: string; org: string; returnUrl: string },
  outcome: 'complete' | 'incomplete',
): Promise<void> {
  const secret = process.env.FAKE_PAYMENTS_SECRET;
  if (!secret || process.env.VERCEL_ENV === 'production') throw new Error('fake payments are disabled');
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const done = outcome === 'complete';
  const { body, signature } = signFakeAccountWebhook(secret, {
    orgId: params.org,
    account: {
      accountId: params.acct,
      chargesEnabled: done,
      payoutsEnabled: done,
      detailsSubmitted: true,
      requirementsDue: done ? [] : ['external_account'],
      country: 'US',
      defaultCurrency: 'usd',
    },
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
