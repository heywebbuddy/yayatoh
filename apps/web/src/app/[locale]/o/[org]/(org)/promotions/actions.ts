'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { endPromotionCommand, MAX_PROMOTION_DAYS, promoteListingCommand } from '@yayatoh/marketplace';
import { revalidatePath, updateTag } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const back = async (org: string, q: string) =>
  redirect({ href: `/o/${org}/promotions?${q}`, locale: await getLocale() });

/** Promote a marketplace listing in search for N days (M6.14b; priced later, nothing charged). */
export async function promoteAction(org: string, eventId: string, form: FormData): Promise<void> {
  const data = await loadConsole(org);
  const days = Number(form.get('days'));
  if (!Number.isInteger(days) || days < 1 || days > MAX_PROMOTION_DAYS) return back(org, 'error=days');
  try {
    await executeCommand(promoteListingCommand, { eventId, days }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return back(org, `error=${err.details?.reason === 'not_listed' ? 'not_listed' : 'failed'}`);
  }
  // Search results are cached in the marketplace scope, which an org's change revalidates.
  for (const tag of orgChangeTags(data.org.id)) updateTag(tag);
  revalidatePath(`/o/${org}/promotions`);
  return back(org, 'done=promoted');
}

export async function endPromotionAction(org: string, eventId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(endPromotionCommand, { eventId }, data.ctx, ports);
  for (const tag of orgChangeTags(data.org.id)) updateTag(tag);
  revalidatePath(`/o/${org}/promotions`);
  return back(org, 'done=ended');
}
