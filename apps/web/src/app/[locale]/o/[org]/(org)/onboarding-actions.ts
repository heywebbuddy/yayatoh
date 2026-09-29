'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { completeOnboardingCommand } from '@yayatoh/tenancy';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * "Finish setup" on the org home (M3.11a): the command checks the required steps itself and moves
 * a self-serve org out of setup mode. The outcome comes back in the address, which the page reads.
 */
export async function completeOnboardingAction(org: string): Promise<void> {
  const data = await loadConsole(org);
  let outcome = 'done';
  try {
    await executeCommand(completeOnboardingCommand, {}, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    outcome =
      (err.details as { reason?: unknown } | undefined)?.reason === 'onboarding_incomplete'
        ? 'incomplete'
        : 'failed';
  }
  redirect({ href: `/o/${org}?onboarding=${outcome}`, locale: await getLocale() });
}
