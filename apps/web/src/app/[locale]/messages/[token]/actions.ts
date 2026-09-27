'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  contactBlockCommand,
  contactMessageCommand,
  contactReportCommand,
  type REPORT_REASONS,
  threadRef,
} from '@yayatoh/messaging';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/components/conversation.tsx';
import { ports } from '@/server/ports.ts';

const fail = (err: unknown): FormState => ({
  done: false,
  code: isDomainError(err) ? String(err.details?.reason ?? '') || err.code : 'internal',
});

/** The link is the only credential: its org comes from the signed thread id, never from input. */
async function ctxFor(token: string) {
  const ref = await threadRef(token);
  return ref ? createCtx({ orgId: ref.orgId }) : null;
}

export async function contactMessageAction(token: string, _p: FormState, form: FormData): Promise<FormState> {
  const ctx = await ctxFor(token);
  if (!ctx) return { done: false, code: 'not_found' };
  const body = String(form.get('body') ?? '').trim();
  if (!body) return { done: false, code: 'required' };
  try {
    await executeCommand(contactMessageCommand, { token, body }, ctx, ports);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/messages/${token}`);
  return { done: true, code: null };
}

export async function contactBlockAction(token: string, _p: FormState, form: FormData): Promise<FormState> {
  const ctx = await ctxFor(token);
  if (!ctx) return { done: false, code: 'not_found' };
  try {
    await executeCommand(contactBlockCommand, { token, blocked: form.get('blocked') === 'yes' }, ctx, ports);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/messages/${token}`);
  return { done: true, code: null };
}

export async function contactReportAction(token: string, _p: FormState, form: FormData): Promise<FormState> {
  const ctx = await ctxFor(token);
  if (!ctx) return { done: false, code: 'not_found' };
  const reason = String(form.get('reason') ?? '') as (typeof REPORT_REASONS)[number];
  try {
    await executeCommand(
      contactReportCommand,
      { token, reason, note: String(form.get('note') ?? '') || undefined },
      ctx,
      ports,
    );
  } catch (err) {
    return fail(err);
  }
  return { done: true, code: null };
}
