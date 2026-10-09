'use server';

import { assignOrganizationPlanCommand } from '@yayatoh/billing';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parsePlanForm, saveAdminPlan } from '@/server/plans.ts';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';

export async function savePlanAction(form: FormData): Promise<void> {
  const staff = await requireStaff('plans');
  const key = String(form.get('key') ?? '');
  let error: string | null = null;
  try {
    const originalKey = String(form.get('originalKey') ?? '');
    if (originalKey && originalKey !== key) throw new Error('invalid_plan');
    await saveAdminPlan(staff.actor, parsePlanForm(form), String(form.get('reason') ?? ''), !originalKey);
  } catch (err) {
    error =
      err instanceof Error &&
      ['invalid_reason', 'active_price_required', 'provider_mismatch'].includes(err.message)
        ? err.message
        : 'invalid_plan';
  }
  revalidatePath('/plans');
  redirect(`/plans?${new URLSearchParams({ edit: key, ...(error ? { error } : { done: 'saved' }) })}`);
}

export async function assignPlanAction(form: FormData): Promise<void> {
  const staff = await requireStaff('plans');
  const orgId = String(form.get('orgId') ?? '');
  if (!z.uuid().safeParse(orgId).success) redirect('/plans?error=invalid_assignment');
  let error: string | null = null;
  try {
    await executeCommand(
      assignOrganizationPlanCommand,
      {
        planKey: String(form.get('planKey') ?? ''),
        reason: String(form.get('reason') ?? ''),
      },
      staff.ctx(orgId),
      ports,
    );
  } catch (err) {
    error =
      isDomainError(err) && err.code === 'invalid_state' ? 'subscription_managed' : 'invalid_assignment';
  }
  revalidatePath('/plans');
  revalidatePath(`/tenants/${orgId}`);
  redirect(`/plans?${new URLSearchParams(error ? { error } : { done: 'assigned', org: orgId })}`);
}
