'use server';

import { reviewChatReportCommand } from '@yayatoh/engagement';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { reviewReportCommand } from '@yayatoh/messaging';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';

const Id = z.uuid();

/**
 * Resolve or dismiss a messaging report with a note. The command runs in the report's org as the
 * staff member (a platform actor), so it is audited there with their name; a report id from
 * another org is simply not found under that org's RLS.
 */
export async function reviewReportAction(orgId: string, reportId: string, form: FormData) {
  if (!Id.safeParse(orgId).success || !Id.safeParse(reportId).success) redirect('/reports');
  const staff = await requireStaff('reports');
  const decision = form.get('decision') === 'dismissed' ? 'dismissed' : 'resolved';
  const note = String(form.get('note') ?? '').trim();
  if (!note) redirect(`/reports?error=note_required&report=${reportId}`);
  if (note.length > 1000) redirect(`/reports?error=note_too_long&report=${reportId}`);
  let outcome: string;
  try {
    await executeCommand(reviewReportCommand, { reportId, decision, note }, staff.ctx(orgId), ports);
    outcome = `done=${decision}`;
  } catch (err) {
    outcome = `error=${isDomainError(err) ? String(err.details?.reason ?? err.code) : 'internal'}`;
  }
  revalidatePath('/reports');
  redirect(`/reports?${outcome}`);
}

/**
 * Resolve or dismiss a networking chat report (M5.8b) with a note: a platform command in the
 * report's org as the staff member, audited there. Same answers as messaging reports.
 */
export async function reviewChatReportAction(orgId: string, reportId: string, form: FormData) {
  if (!Id.safeParse(orgId).success || !Id.safeParse(reportId).success) redirect('/reports');
  const staff = await requireStaff('reports');
  const decision = form.get('decision') === 'dismissed' ? 'dismissed' : 'resolved';
  const note = String(form.get('note') ?? '').trim();
  if (!note) redirect(`/reports?error=note_required&report=${reportId}`);
  if (note.length > 1000) redirect(`/reports?error=note_too_long&report=${reportId}`);
  let outcome: string;
  try {
    await executeCommand(reviewChatReportCommand, { reportId, decision, note }, staff.ctx(orgId), ports);
    outcome = `done=${decision}`;
  } catch (err) {
    outcome = `error=${isDomainError(err) ? String(err.details?.reason ?? err.code) : 'internal'}`;
  }
  revalidatePath('/reports');
  redirect(`/reports?${outcome}`);
}
