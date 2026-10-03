'use server';

import { setRsvpRemindersCommand } from '@yayatoh/automations';
import {
  INVITE_LOCALES,
  type InviteChannel,
  type InviteLocale,
  resetInvitationTemplateCommand,
  sendInvitationsCommand,
  sendTestInvitationCommand,
  setInvitationTemplateCommand,
  setPartyContactCommand,
  setPartyLocaleCommand,
} from '@yayatoh/guests';
import { DomainError, executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * Invitation host tools (M4.1f). Every write goes through a command that needs `guests:write`,
 * so a viewer posting a form is refused by the server, not only by the missing control.
 */
type State = ProgramFormState;

async function run(
  org: string,
  event: string,
  write: (eventId: string, ctx: Parameters<typeof executeCommand>[2]) => Promise<unknown>,
): Promise<State> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  try {
    await write(ev.id, data.ctx);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/guests`, 'layout');
  return success();
}

const channelsOf = (form: FormData): InviteChannel[] =>
  form
    .getAll('channels')
    .map(String)
    .filter((c): c is InviteChannel => c === 'email' || c === 'sms');

const localeOf = (raw: string): InviteLocale => {
  if (!(INVITE_LOCALES as readonly string[]).includes(raw))
    throw new DomainError('validation_failed', 'Invalid input', { field: 'locale' });
  return raw as InviteLocale;
};

/**
 * Every party not sent yet (the page then says how many went and how many had no address), or
 * one party, again.
 */
export async function sendInvitationsAction(
  org: string,
  event: string,
  partyId: string | null,
  _p: State,
  form: FormData,
) {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  let result: { sent: number; noAddress: number };
  try {
    const channels = channelsOf(form);
    if (channels.length === 0)
      throw new DomainError('validation_failed', 'Choose a channel', {
        field: 'channels',
        reason: 'required',
      });
    result = await executeCommand(
      sendInvitationsCommand,
      { eventId: ev.id, channels, ...(partyId ? { partyIds: [partyId], resend: true } : {}) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/guests`, 'layout');
  if (partyId) return success();
  redirect({
    href: `/o/${org}/e/${event}/guests/invitations?sent=${result.sent}&skipped=${result.noAddress}`,
    locale: await getLocale(),
  });
  return success();
}

export async function saveTemplateAction(
  org: string,
  event: string,
  locale: string,
  _p: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      setInvitationTemplateCommand,
      {
        eventId,
        locale: localeOf(locale),
        subject: String(form.get('subject') ?? ''),
        message: String(form.get('message') ?? ''),
        smsText: String(form.get('smsText') ?? ''),
      },
      ctx,
      ports,
    ),
  );
}

export async function resetTemplateAction(
  org: string,
  event: string,
  locale: string,
  _p: State,
  _f: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(resetInvitationTemplateCommand, { eventId, locale: localeOf(locale) }, ctx, ports),
  );
}

export async function testSendAction(org: string, event: string, locale: string, _p: State, _f: FormData) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(sendTestInvitationCommand, { eventId, locale: localeOf(locale) }, ctx, ports),
  );
}

/** Days are typed as a list ("14, 3"); each 1–90. */
export async function setRemindersAction(org: string, event: string, _p: State, form: FormData) {
  const enabled = form.get('enabled') === '1';
  return run(org, event, (eventId, ctx) => {
    if (!enabled) return executeCommand(setRsvpRemindersCommand, { eventId, enabled: false }, ctx, ports);
    const raw = String(form.get('days') ?? '').trim();
    const days = raw
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((d) => Number(d));
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 90) || days.length > 5)
      throw new DomainError('validation_failed', 'Invalid input', { field: 'days', reason: 'invalid_days' });
    const channels = channelsOf(form);
    if (channels.length === 0)
      throw new DomainError('validation_failed', 'Choose a channel', {
        field: 'channels',
        reason: 'required',
      });
    return executeCommand(setRsvpRemindersCommand, { eventId, enabled: true, days, channels }, ctx, ports);
  });
}

export async function setPartyContactAction(
  org: string,
  event: string,
  partyId: string,
  _p: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      setPartyContactCommand,
      {
        eventId,
        partyId,
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? ''),
      },
      ctx,
      ports,
    ),
  );
}

export async function setPartyLocaleAction(
  org: string,
  event: string,
  partyId: string,
  _p: State,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      setPartyLocaleCommand,
      { eventId, partyId, locale: localeOf(String(form.get('locale') ?? '')) },
      ctx,
      ports,
    ),
  );
}
