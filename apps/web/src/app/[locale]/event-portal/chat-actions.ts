'use server';

import {
  blockVisitorCommand,
  markBoothReadCommand,
  REPORT_REASONS,
  type ReportReason,
  replyBoothChatCommand,
  reportVisitorCommand,
  setBoothChatCommand,
} from '@yayatoh/engagement';
import { type Ctx, executeCommand } from '@yayatoh/kernel';
import { refresh } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { currentPortalPrincipal, portalRequestCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * Booth chat actions for an exhibitor's portal people (M5.8b). The org, event and exhibitor come
 * from the portal session; every command re-checks the account and its exhibitor in its
 * transaction. Counted against the `chat` limit per device, network and portal account.
 */
async function asBooth(): Promise<{ ctx: Ctx } | FormState> {
  const p = await currentPortalPrincipal();
  if (p?.subjectKind !== 'exhibitor') return { ok: false, code: 'forbidden' };
  const limit = await limitAction('chat', { identity: `portal:${p.accountId}`, scope: p.eventId });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  return { ctx: await portalRequestCtx(p) };
}

async function run(fn: (ctx: Ctx) => Promise<unknown>, opts: { refresh?: boolean } = {}): Promise<FormState> {
  const a = await asBooth();
  if (!('ctx' in a)) return a;
  try {
    await fn(a.ctx);
  } catch (err) {
    return failure(err);
  }
  if (opts.refresh) refresh();
  return success();
}

export async function setBoothChatAction(enabled: boolean, _prev: FormState): Promise<FormState> {
  return run((ctx) => executeCommand(setBoothChatCommand, { enabled }, ctx, ports), { refresh: true });
}

export async function replyBoothChatAction(
  conversationId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run((ctx) =>
    executeCommand(
      replyBoothChatCommand,
      { conversationId, body: String(form.get('body') ?? '') },
      ctx,
      ports,
    ),
  );
}

export async function markBoothReadAction(conversationId: string): Promise<FormState> {
  return run((ctx) => executeCommand(markBoothReadCommand, { conversationId }, ctx, ports));
}

export async function blockVisitorAction(
  conversationId: string,
  blocked: boolean,
  _prev: FormState,
): Promise<FormState> {
  return run((ctx) => executeCommand(blockVisitorCommand, { conversationId, blocked }, ctx, ports), {
    refresh: true,
  });
}

export async function reportVisitorAction(
  conversationId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const reason = String(form.get('reason') ?? '').trim();
  const details = String(form.get('details') ?? '').trim();
  if (!(REPORT_REASONS as readonly string[]).includes(reason))
    return { ok: false, code: 'validation_failed', fields: ['reason'] };
  if (reason === 'other' && !details) return { ok: false, code: 'validation_failed', fields: ['details'] };
  return run((ctx) =>
    executeCommand(
      reportVisitorCommand,
      { conversationId, reason: reason as ReportReason, details },
      ctx,
      ports,
    ),
  );
}
