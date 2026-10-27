'use server';

import {
  markLobbyReadCommand,
  REPORT_REASONS,
  type ReportReason,
  reportLobbyMessageCommand,
  sendLobbyMessageCommand,
} from '@yayatoh/engagement';
import { executeCommand } from '@yayatoh/kernel';
import { refresh } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { attendeeCtx, networkEmail, networkTarget } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

async function run(
  slug: string,
  fn: (at: { eventId: string; email: string }, ctx: ReturnType<typeof attendeeCtx>) => Promise<unknown>,
): Promise<FormState> {
  const target = await networkTarget(slug);
  const email = await networkEmail();
  if (!target || !email) return { ok: false, code: 'not_found' };
  const limit = await limitAction('chat', { identity: email, scope: target.eventId });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  try {
    await fn({ eventId: target.eventId, email }, attendeeCtx(target));
  } catch (err) {
    return failure(err);
  }
  refresh();
  return success();
}

export async function sendLobbyAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  return run(slug, (at, ctx) =>
    executeCommand(sendLobbyMessageCommand, { ...at, body: String(form.get('body') ?? '') }, ctx, ports),
  );
}

export async function markLobbyReadAction(slug: string): Promise<FormState> {
  return run(slug, (at, ctx) => executeCommand(markLobbyReadCommand, at, ctx, ports));
}

export async function reportLobbyAction(
  slug: string,
  messageId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const reason = String(form.get('reason') ?? 'other') as ReportReason;
  return run(slug, (at, ctx) =>
    executeCommand(
      reportLobbyMessageCommand,
      {
        ...at,
        messageId,
        reason: (REPORT_REASONS as readonly string[]).includes(reason) ? reason : 'other',
        details: String(form.get('details') ?? ''),
      },
      ctx,
      ports,
    ),
  );
}
