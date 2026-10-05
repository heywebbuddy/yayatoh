'use server';

import { exemptProblem, rejectCharityCommand, verifyCharityCommand } from '@yayatoh/donations';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { charityOfOrg, irsList } from '@/server/charities.ts';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';

const Id = z.uuid();

function back(orgId: string, outcome: string): never {
  revalidatePath(`/charities/${orgId}`);
  revalidatePath('/charities');
  redirect(`/charities/${orgId}?${outcome}`);
}

const reasonOf = (err: unknown) =>
  isDomainError(err)
    ? String((err.details as { reason?: unknown } | undefined)?.reason ?? err.code)
    : 'internal';

/**
 * Verify the version staff reviewed (admin and support; audited in the org). The IRS record is
 * looked up again here, never taken from the form: only an eligible record for the profile's EIN
 * (the sponsor's, for a sponsored project) verifies.
 */
export async function verifyCharityAction(orgId: string, version: number, form: FormData) {
  if (!Id.safeParse(orgId).success) redirect('/charities');
  const staff = await requireStaff('charities');
  const profile = await charityOfOrg(staff, orgId);
  const irs = irsList();
  if (!profile || !irs) back(orgId, 'error=unavailable');
  const record = await irs.lookup(profile.sponsorEin ?? profile.ein);
  const problem = exemptProblem(record);
  if (problem || !record) back(orgId, `error=${problem ?? 'not_listed'}`);
  let outcome = 'done=verified';
  try {
    await executeCommand(
      verifyCharityCommand,
      { version, irs: record, note: String(form.get('note') ?? '').trim() || null },
      staff.ctx(orgId),
      ports,
    );
  } catch (err) {
    outcome = `error=${reasonOf(err)}`;
  }
  back(orgId, outcome);
}

/** Reject (or withdraw a verification) with a note the org sees (admin and support; audited). */
export async function rejectCharityAction(orgId: string, version: number, form: FormData) {
  if (!Id.safeParse(orgId).success) redirect('/charities');
  const staff = await requireStaff('charities');
  let outcome = 'done=rejected';
  try {
    await executeCommand(
      rejectCharityCommand,
      { version, note: String(form.get('note') ?? '') },
      staff.ctx(orgId),
      ports,
    );
  } catch (err) {
    outcome = `error=${isDomainError(err) && err.code === 'validation_failed' ? 'note' : reasonOf(err)}`;
  }
  back(orgId, outcome);
}
