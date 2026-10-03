'use server';

import {
  blockPersonCommand,
  cancelMeetingCommand,
  optInCommand,
  optOutCommand,
  reportPersonCommand,
  requestConnectionCommand,
  requestMeetingCommand,
  respondConnectionCommand,
  respondMeetingCommand,
  unblockPersonCommand,
  updateProfileCommand,
  withdrawConnectionCommand,
} from '@yayatoh/engagement';
import { type Ctx, executeCommand } from '@yayatoh/kernel';
import { refresh } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { attendeeCtx, networkEmail, networkTarget } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * Networking actions (M5.8a). The org and event come from the slug, the person from the address
 * this browser proved; every action is rate limited per device, network and address. The module
 * refuses anyone without an active place at the event.
 */
interface Attendee {
  readonly at: { readonly eventId: string; readonly email: string };
  readonly ctx: Ctx;
}

async function attendee(slug: string): Promise<Attendee | FormState> {
  const target = await networkTarget(slug);
  const email = await networkEmail();
  if (!target || !email) return { ok: false, code: 'not_found' };
  const limit = await limitAction('networking', { identity: email, scope: target.eventId });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  return { at: { eventId: target.eventId, email }, ctx: attendeeCtx(target) };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/**
 * Run one attendee command and re-render the page. Blocking and reporting leave the person's page
 * (they are gone from it now): the form navigates to the directory itself instead.
 */
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
  if (opts.refresh !== false) refresh();
  return success();
}

const profileFields = (form: FormData) => ({
  displayName: text(form, 'displayName'),
  headline: text(form, 'headline'),
  company: text(form, 'company'),
  bio: text(form, 'bio'),
  interests: String(form.get('interests') ?? ''),
});

export async function optInAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const fields = profileFields(form);
  const consent = form.get('consent') === 'yes';
  const bad = [...(fields.displayName ? [] : ['displayName']), ...(consent ? [] : ['consent'])];
  if (bad.length) return { ok: false, code: 'validation_failed', fields: bad };
  return run(slug, (a) => executeCommand(optInCommand, { ...a.at, ...fields, consent: true }, a.ctx, ports));
}

export async function updateProfileAction(
  slug: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const fields = profileFields(form);
  if (!fields.displayName) return { ok: false, code: 'validation_failed', fields: ['displayName'] };
  return run(slug, (a) => executeCommand(updateProfileCommand, { ...a.at, ...fields }, a.ctx, ports));
}

export async function optOutAction(slug: string, _prev: FormState): Promise<FormState> {
  return run(slug, (a) => executeCommand(optOutCommand, a.at, a.ctx, ports));
}

export async function connectAction(
  slug: string,
  personId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(slug, (a) =>
    executeCommand(
      requestConnectionCommand,
      { ...a.at, personId, message: text(form, 'message') },
      a.ctx,
      ports,
    ),
  );
}

export async function respondConnectionAction(
  slug: string,
  connectionId: string,
  accept: boolean,
  _prev: FormState,
): Promise<FormState> {
  return run(slug, (a) =>
    executeCommand(respondConnectionCommand, { ...a.at, connectionId, accept }, a.ctx, ports),
  );
}

export async function withdrawConnectionAction(
  slug: string,
  connectionId: string,
  _prev: FormState,
): Promise<FormState> {
  return run(slug, (a) => executeCommand(withdrawConnectionCommand, { ...a.at, connectionId }, a.ctx, ports));
}

export async function requestMeetingAction(
  slug: string,
  personId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const slotId = text(form, 'slotId');
  const locationId = text(form, 'locationId');
  const bad = [...(slotId ? [] : ['slotId']), ...(locationId ? [] : ['locationId'])];
  if (bad.length) return { ok: false, code: 'validation_failed', fields: bad };
  return run(slug, (a) =>
    executeCommand(
      requestMeetingCommand,
      { ...a.at, personId, slotId, locationId, message: text(form, 'message') },
      a.ctx,
      ports,
    ),
  );
}

export async function respondMeetingAction(
  slug: string,
  meetingId: string,
  accept: boolean,
  _prev: FormState,
): Promise<FormState> {
  return run(slug, (a) =>
    executeCommand(respondMeetingCommand, { ...a.at, meetingId, accept }, a.ctx, ports),
  );
}

export async function cancelMeetingAction(
  slug: string,
  meetingId: string,
  _prev: FormState,
): Promise<FormState> {
  return run(slug, (a) => executeCommand(cancelMeetingCommand, { ...a.at, meetingId }, a.ctx, ports));
}

export async function blockAction(slug: string, personId: string, _prev: FormState): Promise<FormState> {
  return run(slug, (a) => executeCommand(blockPersonCommand, { ...a.at, personId }, a.ctx, ports), {
    refresh: false,
  });
}

export async function unblockAction(slug: string, personId: string, _prev: FormState): Promise<FormState> {
  return run(slug, (a) => executeCommand(unblockPersonCommand, { ...a.at, personId }, a.ctx, ports));
}

export async function reportAction(
  slug: string,
  personId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const reason = text(form, 'reason');
  const details = text(form, 'details');
  if (!reason) return { ok: false, code: 'validation_failed', fields: ['reason'] };
  if (reason === 'other' && !details) return { ok: false, code: 'validation_failed', fields: ['details'] };
  return run(
    slug,
    (a) => executeCommand(reportPersonCommand, { ...a.at, personId, reason, details }, a.ctx, ports),
    { refresh: false },
  );
}
