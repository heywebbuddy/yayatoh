'use server';

import { type Ctx, DomainError, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  liftAutoPauseCommand,
  MESSAGING_SERVICE_SID,
  QUOTA_CHANNELS,
  type QuotaChannel,
  senderStatusFromEnv,
  setChannelSenderCommand,
  setQuotaLimitCommand,
} from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';

const Id = z.uuid();

/** Run one staff command for an org, then come back to its messaging page with the outcome. */
async function run(
  orgId: string,
  action: 'messaging' | 'quotas',
  done: string,
  fn: (ctx: Ctx) => Promise<unknown>,
) {
  if (!Id.safeParse(orgId).success) redirect('/');
  const staff = await requireStaff(action);
  let outcome: string;
  try {
    await fn(staff.ctx(orgId));
    outcome = `done=${done}`;
  } catch (err) {
    outcome = `error=${isDomainError(err) ? String(err.details?.reason ?? err.code) : 'internal'}`;
  }
  revalidatePath(`/tenants/${orgId}/messaging`);
  redirect(`/tenants/${orgId}/messaging?${outcome}`);
}

/** Lift a complaint-rate auto-pause after review (admin and support; note required; audited). */
export async function liftAutoPauseAction(orgId: string, form: FormData) {
  await run(orgId, 'messaging', 'lifted', (ctx) =>
    executeCommand(liftAutoPauseCommand, { note: String(form.get('note') ?? '') }, ctx, ports),
  );
}

/** Set (or reset) one channel's monthly quota (admin and finance; reason required; audited). */
export async function quotaAction(orgId: string, channel: QuotaChannel, form: FormData) {
  if (!QUOTA_CHANNELS.includes(channel)) redirect('/');
  const raw = String(form.get('limit') ?? '').trim();
  const reset = form.get('intent') === 'reset';
  await run(orgId, 'quotas', reset ? 'quota_reset' : 'quota', (ctx) =>
    executeCommand(
      setQuotaLimitCommand,
      {
        channel,
        monthlyLimit: reset ? null : /^\d+$/.test(raw) ? Number(raw) : Number.NaN,
        reason: String(form.get('reason') ?? ''),
      },
      ctx,
      ports,
    ),
  );
}

const E164 = /^\+[1-9][0-9]{6,14}$/;
const invalid = (reason: string) => new DomainError('validation_failed', reason, { reason });

/** An optional display number: E.164 or empty. */
function displayNumber(form: FormData): string | null {
  const raw = String(form.get('number') ?? '').replace(/[\s()-]/g, '');
  if (!raw) return null;
  if (!E164.test(raw)) throw invalid('number');
  return raw;
}

/**
 * The tenant's own SMS sender (M3.5b; admin and support; audited): a Twilio Messaging Service,
 * saved with its 10DLC campaign status as Twilio reports it now; or back to the shared number.
 */
export async function smsSenderAction(orgId: string, form: FormData) {
  const clear = form.get('intent') === 'clear';
  await run(orgId, 'messaging', clear ? 'sender_cleared' : 'sender', async (ctx) => {
    if (clear) return executeCommand(setChannelSenderCommand, { kind: 'clear', channel: 'sms' }, ctx, ports);
    const sid = String(form.get('sid') ?? '').trim();
    if (!MESSAGING_SERVICE_SID.test(sid)) throw invalid('sid');
    const number = displayNumber(form);
    const port = senderStatusFromEnv(process.env);
    if (!port) throw invalid('unavailable');
    const campaignStatus = await port.campaignStatus(sid);
    return executeCommand(
      setChannelSenderCommand,
      { kind: 'sms', messagingServiceSid: sid, displayNumber: number, campaignStatus },
      ctx,
      ports,
    );
  });
}

/** The tenant's WhatsApp route (decision P3-2): the Cloud API with its phone number id, or the gateway. */
export async function whatsappSenderAction(orgId: string, form: FormData) {
  const clear = form.get('intent') === 'clear';
  await run(orgId, 'messaging', clear ? 'sender_cleared' : 'sender', async (ctx) => {
    if (clear)
      return executeCommand(setChannelSenderCommand, { kind: 'clear', channel: 'whatsapp' }, ctx, ports);
    const route = form.get('route') === 'gateway' ? 'gateway' : 'cloud';
    const ref = String(form.get('ref') ?? '').trim();
    if (route === 'cloud' && !/^[0-9]{5,30}$/.test(ref)) throw invalid('phone_number_id');
    if (route === 'gateway' && ref && !/^[A-Za-z0-9_-]{1,64}$/.test(ref)) throw invalid('gateway_sender');
    return executeCommand(
      setChannelSenderCommand,
      { kind: 'whatsapp', route, senderRef: ref || null, displayNumber: displayNumber(form) },
      ctx,
      ports,
    );
  });
}
