'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { MODERATION_REASON_MAX, moderateListingCommand } from '@yayatoh/marketplace';
import { signLinkToken } from '@yayatoh/platform';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';

const Id = z.uuid();

/**
 * Hide a listing from the marketplace and its search, or show it again (M6.14a), with a reason.
 * A platform command in the listing's org as the staff member, so it is audited there with their
 * name and the reason; the search index follows through the outbox (the worker).
 */
export async function moderateListingAction(orgId: string, eventId: string, hidden: boolean, form: FormData) {
  if (!Id.safeParse(orgId).success || !Id.safeParse(eventId).success) redirect('/listings');
  const staff = await requireStaff('listings');
  const back = hidden ? '/listings' : '/listings?state=hidden';
  const sep = back.includes('?') ? '&' : '?';
  const reason = String(form.get('reason') ?? '').trim();
  if (!reason) redirect(`${back}${sep}error=reason_required&listing=${eventId}`);
  if (reason.length > MODERATION_REASON_MAX)
    redirect(`${back}${sep}error=reason_too_long&listing=${eventId}`);
  let outcome: string;
  try {
    await executeCommand(moderateListingCommand, { eventId, hidden, reason }, staff.ctx(orgId), ports);
    outcome = `done=${hidden ? 'hidden' : 'shown'}`;
    await revalidatePublic(orgId);
  } catch (err) {
    outcome = `error=${isDomainError(err) ? String(err.details?.reason ?? err.code) : 'internal'}`;
  }
  revalidatePath('/listings');
  redirect(`${back}${sep}${outcome}`);
}

const appOrigin = () =>
  process.env.NEXT_PUBLIC_APP_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

/** Drop the org's and the marketplace's cached public reads now (the worker's signed call). */
async function revalidatePublic(orgId: string) {
  try {
    const res = await fetch(`${appOrigin()}/api/internal/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: signLinkToken('cache.revalidate', orgId) }),
    });
    if (!res.ok) console.warn(`revalidate ${orgId}: ${res.status}`);
  } catch (err) {
    console.warn(`revalidate ${orgId}: ${(err as Error).message}`);
  }
}
