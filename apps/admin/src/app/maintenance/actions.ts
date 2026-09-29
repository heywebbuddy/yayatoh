'use server';

import { isTwoFactorError, type StepUpProof } from '@yayatoh/auth';
import type { FreezeValue } from '@yayatoh/platform';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth, getTwoFactor } from '@/server/auth.ts';
import { orgsBySlug, setFreeze } from '@/server/maintenance.ts';
import { requireStaff, type Staff } from '@/server/staff.ts';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function fail(code: string, extra = ''): never {
  redirect(`/maintenance?error=${code}${extra}#freeze`);
}

/**
 * The staff member confirms it's them (authenticator code, else password) in the same form, as
 * for restoring an org: a freeze stops every organizer's writes, so it is never one click.
 */
async function confirmItsThem(staff: Staff, form: FormData): Promise<void> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const twoFactor = getTwoFactor();
  const method = await twoFactor.method(staff.userId);
  if (method === 'email') fail('step_up_method');
  const proof: StepUpProof =
    method === 'totp'
      ? { method: 'totp', code: String(form.get('code') ?? '') }
      : { method: 'password', password: String(form.get('password') ?? '') };
  let error: string | null = null;
  try {
    await twoFactor.stepUp({ userId: staff.userId, sessionToken: session.session.token, proof });
  } catch (err) {
    if (!isTwoFactorError(err)) throw err;
    error = err.code === 'rate_limited' ? 'step_up_rate_limited' : 'step_up';
  }
  if (error) fail(error);
}

function reasonOf(form: FormData): string {
  const reason = String(form.get('reason') ?? '').trim();
  if (reason.length < 3 || reason.length > 500) fail('reason');
  return reason;
}

/**
 * Start (or change) the read-only freeze (M2.5a): platform-wide, or for the listed orgs. Admins
 * only; a reason and step-up are required. Every write command is refused while it is on.
 */
export async function startFreezeAction(form: FormData) {
  const staff = await requireStaff('maintenance');
  const reason = reasonOf(form);
  const scope = String(form.get('scope') ?? '');
  if (scope !== 'platform' && scope !== 'orgs') fail('scope');
  const endRaw = String(form.get('expectedEndAt') ?? '').trim();
  let expectedEndAt: string | null = null;
  if (endRaw) {
    // A datetime-local value, read as UTC (the form says so).
    const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(endRaw) ? endRaw : `${endRaw}Z`);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) fail('expected_end');
    expectedEndAt = d.toISOString();
  }
  let value: FreezeValue;
  if (scope === 'platform') {
    if (form.get('confirmPlatform') !== 'on') fail('confirm_platform');
    value = { scope: 'platform', expectedEndAt };
  } else {
    const slugs = [
      ...new Set(
        String(form.get('orgs') ?? '')
          .split(/[\s,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (slugs.length === 0 || slugs.length > 100 || slugs.some((s) => !SLUG.test(s))) fail('orgs');
    const { ids, unknown } = await orgsBySlug(staff, slugs);
    if (unknown.length) fail('orgs_unknown', `&slugs=${encodeURIComponent(unknown.join(','))}`);
    value = { scope: 'orgs', orgIds: ids, expectedEndAt };
  }
  await confirmItsThem(staff, form);
  await setFreeze(staff, value, reason);
  revalidatePath('/maintenance');
  redirect('/maintenance?done=started#freeze');
}

/** End the read-only freeze (writes work again at once). Admins only; reason and step-up. */
export async function endFreezeAction(form: FormData) {
  const staff = await requireStaff('maintenance');
  const reason = reasonOf(form);
  await confirmItsThem(staff, form);
  await setFreeze(staff, null, reason);
  revalidatePath('/maintenance');
  redirect('/maintenance?done=ended#freeze');
}
