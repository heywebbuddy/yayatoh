'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { continuePayoutOnboardingCommand, recordPayoutAccountCommand } from '@yayatoh/payments';
import { roleCan } from '@yayatoh/tenancy';
import { redirect } from 'next/navigation';
import { loadConsole } from '@/server/console.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

/**
 * Start (or continue) payout onboarding: the provider creates the org's connected account
 * (idempotent per org, outside any transaction), we record it, then send the user to the
 * provider's hosted onboarding. The account's state arrives later by verified webhook only.
 * Both steps are step-up commands (where money goes, M1.2c): without a recent sign-in or
 * confirmation this answers `step_up_required` and the form asks the person to confirm.
 */
export async function startPayoutOnboarding(
  org: string,
  locale: string,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'payouts:manage')) redirect(`/${locale}/o/${org}/payouts`);
  const provider = getPaymentProvider();
  let accountId: string;
  try {
    ({ accountId } = await executeCommand(continuePayoutOnboardingCommand, {}, data.ctx, ports));
  } catch (err) {
    if (!isDomainError(err) || err.code !== 'not_found')
      return { code: isDomainError(err) ? err.code : 'internal' };
    const created = await provider.createConnectedAccount({
      orgId: data.org.id,
      country: data.org.country,
      email: data.session.email,
    });
    try {
      ({ accountId } = await executeCommand(
        recordPayoutAccountCommand,
        { provider: provider.name, accountId: created.accountId, country: data.org.country },
        data.ctx,
        ports,
      ));
    } catch (e) {
      return { code: isDomainError(e) ? e.code : 'internal' };
    }
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
