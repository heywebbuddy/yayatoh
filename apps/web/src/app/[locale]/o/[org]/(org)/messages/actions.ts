'use server';

import { assistSupport, SUPPORT_MESSAGES_MAX, type SupportAssistResultDto } from '@yayatoh/ai';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  blockThreadCommand,
  type REPORT_REASONS,
  replyToThreadCommand,
  reportThreadCommand,
  threadQuery,
} from '@yayatoh/messaging';
import { roleCan } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { FormState } from '@/components/conversation.tsx';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { aiDrafter } from '@/server/ai.ts';
import { aiCall } from '@/server/ai-compose.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const fail = (err: unknown): FormState => ({
  done: false,
  code: isDomainError(err) ? String(err.details?.reason ?? '') || err.code : 'internal',
});

/**
 * AI1: sort a conversation and draft a reply. Message bodies only: never the contact's address.
 * It sends nothing; the staff member edits the draft and sends it with the reply form.
 */
export async function assistThreadAction(
  org: string,
  threadId: string,
): Promise<AiComposeResult<SupportAssistResultDto>> {
  const data = await loadConsole(org);
  if (!data.modules.has('ai_support_assist') || !roleCan(data.role, 'messages:send'))
    return { ok: false, code: 'forbidden' };
  const locale = await getLocale();
  return aiCall({ orgId: data.org.id, userId: data.session.userId, key: 'assist' }, async () => {
    const thread = await executeQuery(threadQuery, { threadId }, data.ctx, ports);
    const value = await assistSupport(data.ctx, ports, aiDrafter(), {
      kind: 'conversation',
      locale,
      messages: thread.messages.slice(-SUPPORT_MESSAGES_MAX).map((m) => ({
        from: m.direction === 'out' ? ('organizer' as const) : ('customer' as const),
        body: m.body.slice(0, 2000),
      })),
    });
    return { value, balance: value.balance };
  });
}

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
