'use server';

import {
  blockBoothCommand,
  markChatReadCommand,
  REPORT_REASONS,
  type ReportReason,
  reportChatCommand,
  sendBoothMessageCommand,
  sendChatMessageCommand,
} from '@yayatoh/engagement';
import { type Ctx, executeCommand } from '@yayatoh/kernel';
import { refresh } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { attendeeCtx, networkEmail, networkTarget } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * Networking chat actions (M5.8b). As in the rest of networking, the org and event come from the
 * slug and the person from the address this browser proved; the engagement module decides who
 * may write to whom (connections, meetings, blocks, booths) and keeps the message limits. Every
 * action also counts against the `chat` limit per device, network and address.
 */
interface Attendee {
  readonly at: { readonly eventId: string; readonly email: string };
  readonly ctx: Ctx;
}

async function attendee(slug: string): Promise<Attendee | FormState> {
  const target = await networkTarget(slug);
  const email = await networkEmail();
  if (!target || !email) return { ok: false, code: 'not_found' };
  const limit = await limitAction('chat', { identity: email, scope: target.eventId });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  return { at: { eventId: target.eventId, email }, ctx: attendeeCtx(target) };
}

async function run(
  slug: string,
  fn: (a: Attendee) => Promise<unknown>,
  opts: { refresh?: boolean } = {},
): Promise<FormState> {
  const a = await attendee(slug);
  if (!('at' in a)) return a;
  try {
    await fn(a);
  } catch (err) {
    return failure(err);
  }
  if (opts.refresh) refresh();
  return success();
}

const body = (form: FormData) => String(form.get('body') ?? '');

export async function sendChatAction(
  slug: string,
  personId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(slug, (a) =>
    executeCommand(sendChatMessageCommand, { ...a.at, personId, body: body(form) }, a.ctx, ports),
  );
}

export async function sendBoothAction(
  slug: string,
  exhibitorId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(slug, (a) =>
    executeCommand(sendBoothMessageCommand, { ...a.at, exhibitorId, body: body(form) }, a.ctx, ports),
  );
}

export async function markChatReadAction(slug: string, conversationId: string): Promise<FormState> {
  return run(slug, (a) => executeCommand(markChatReadCommand, { ...a.at, conversationId }, a.ctx, ports));
}

export async function blockBoothAction(
  slug: string,
  exhibitorId: string,
  blocked: boolean,
  _prev: FormState,
): Promise<FormState> {
  return run(
    slug,
    (a) => executeCommand(blockBoothCommand, { ...a.at, exhibitorId, blocked }, a.ctx, ports),
    { refresh: true },
  );
}

/** Report a conversation (it also blocks): the form then leaves for the chat list itself. */
export async function reportChatAction(
  slug: string,
  conversationId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const reason = String(form.get('reason') ?? '').trim();
  const details = String(form.get('details') ?? '').trim();
  if (!(REPORT_REASONS as readonly string[]).includes(reason))
    return { ok: false, code: 'validation_failed', fields: ['reason'] };
  if (reason === 'other' && !details) return { ok: false, code: 'validation_failed', fields: ['details'] };
  return run(slug, (a) =>
    executeCommand(
      reportChatCommand,
      { ...a.at, conversationId, reason: reason as ReportReason, details },
      a.ctx,
      ports,
    ),
  );
}
