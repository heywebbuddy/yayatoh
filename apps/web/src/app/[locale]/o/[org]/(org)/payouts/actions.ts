'use server';

import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { payoutAccountIdQuery, recordPayoutAccountCommand } from '@yayatoh/payments';
import { roleCan } from '@yayatoh/tenancy';
import { redirect } from 'next/navigation';
import { loadConsole } from '@/server/console.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

/**
 * Start (or continue) payout onboarding: the provider creates the org's connected account
 * (idempotent per org, outside any transaction), we record it, then send the user to the
 * provider's hosted onboarding. The account's state arrives later by verified webhook only.
 */
export async function startPayoutOnboarding(org: string, locale: string): Promise<void> {
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'payouts:manage')) redirect(`/${locale}/o/${org}/payouts`);
  const provider = getPaymentProvider();
  let { accountId } = await executeQuery(payoutAccountIdQuery, {}, data.ctx, ports);
  if (!accountId) {
    const created = await provider.createConnectedAccount({
      orgId: data.org.id,
      country: data.org.country,
      email: data.session.email,
    });
    ({ accountId } = await executeCommand(
      recordPayoutAccountCommand,
      { provider: provider.name, accountId: created.accountId, country: data.org.country },
      data.ctx,
      ports,
    ));
  }
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const here = `${origin}${locale === 'en' ? '' : `/${locale}`}/o/${org}/payouts`;
  const link = await provider.createOnboardingLink({
    orgId: data.org.id,
    accountId,
    returnUrl: `${here}?onboarding=returned`,
    refreshUrl: here,
  });
  redirect(link.url);
}
