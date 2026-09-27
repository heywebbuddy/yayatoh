'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  blockThreadCommand,
  type REPORT_REASONS,
  replyToThreadCommand,
  reportThreadCommand,
} from '@yayatoh/messaging';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/components/conversation.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const fail = (err: unknown): FormState => ({
  done: false,
  code: isDomainError(err) ? String(err.details?.reason ?? '') || err.code : 'internal',
});

export async function replyAction(
  org: string,
  threadId: string,
  _p: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const body = String(form.get('body') ?? '').trim();
  if (!body) return { done: false, code: 'required' };
  try {
    await executeCommand(replyToThreadCommand, { threadId, body }, data.ctx, ports);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/o/${org}/messages/${threadId}`);
  return { done: true, code: null };
}

export async function blockAction(
  org: string,
  threadId: string,
  _p: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      blockThreadCommand,
      { threadId, blocked: form.get('blocked') === 'yes' },
      data.ctx,
      ports,
    );
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/o/${org}/messages/${threadId}`);
  return { done: true, code: null };
}

export async function reportAction(
  org: string,
  threadId: string,
  _p: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const reason = String(form.get('reason') ?? '') as (typeof REPORT_REASONS)[number];
  try {
    await executeCommand(
      reportThreadCommand,
      { threadId, reason, note: String(form.get('note') ?? '') || undefined },
      data.ctx,
      ports,
    );
  } catch (err) {
    return fail(err);
  }
  return { done: true, code: null };
}
