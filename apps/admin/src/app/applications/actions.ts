'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  addApplicationNote,
  approveApplication,
  assignApplication,
  markInReview,
  resendInvitation,
  sendDecision,
} from '@/server/applications.ts';
import { requireStaff } from '@/server/staff.ts';

const done = (id: string, what: string): never => {
  revalidatePath('/applications');
  revalidatePath(`/applications/${id}`);
  return redirect(`/applications/${id}?done=${what}`);
};
const fail = (id: string, what: string): never => redirect(`/applications/${id}?error=${what}`);

async function guarded(id: string) {
  if (!z.uuid().safeParse(id).success) redirect('/applications');
  return requireStaff('applications');
}

export async function assignAction(id: string, form: FormData) {
  const staff = await guarded(id);
  const who = String(form.get('assignee') ?? '');
  try {
    await assignApplication(staff, id, who === '' || who === 'none' ? null : who);
  } catch {
    fail(id, 'assign');
  }
  done(id, 'assigned');
}

export async function noteAction(id: string, form: FormData) {
  const staff = await guarded(id);
  try {
    await addApplicationNote(staff, id, String(form.get('body') ?? ''));
  } catch {
    fail(id, 'note');
  }
  done(id, 'noted');
}

export async function reviewAction(id: string) {
  const staff = await guarded(id);
  try {
    await markInReview(staff, id);
  } catch {
    fail(id, 'status');
  }
  done(id, 'in_review');
}

export async function approveAction(id: string, form: FormData) {
  const staff = await guarded(id);
  let sent = false;
  try {
    sent = (
      await approveApplication(staff, id, {
        plan: String(form.get('plan') ?? ''),
        note: String(form.get('note') ?? ''),
      })
    ).emailSent;
  } catch {
    fail(id, 'approve');
  }
  done(id, sent ? 'approved' : 'approved_no_email');
}

export async function resendAction(id: string) {
  const staff = await guarded(id);
  let sent = false;
  try {
    sent = (await resendInvitation(staff, id)).emailSent;
  } catch {
    fail(id, 'resend');
  }
  done(id, sent ? 'resent' : 'approved_no_email');
}

async function decide(kind: 'needs_info' | 'rejected', id: string, form: FormData) {
  const staff = await guarded(id);
  try {
    await sendDecision(staff, id, kind, {
      subject: String(form.get('subject') ?? ''),
      body: String(form.get('body') ?? ''),
    });
  } catch {
    fail(id, 'email');
  }
  done(id, kind);
}

export async function needsInfoAction(id: string, form: FormData) {
  return decide('needs_info', id, form);
}

export async function rejectAction(id: string, form: FormData) {
  return decide('rejected', id, form);
}
