'use server';

import { executeCommand, moneyFromDecimal } from '@yayatoh/kernel';
import {
  assignSponsoredSessionCommand,
  cancelSponsorGrantCommand,
  DELIVERABLE_OWNERS,
  grantSponsorPackageCommand,
  inviteSponsorContactCommand,
  LOGO_PLACEMENTS,
  resendSponsorInviteCommand,
  revokeSponsorContactCommand,
  saveSponsorPackageCommand,
  setSponsorExhibitorCommand,
  unassignSponsoredSessionCommand,
} from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * Sponsor packages and sponsors, organizer side (M5.4b): package terms per tier, granting and
 * cancelling packages, the exhibitor a sponsor exhibits as, sponsor contacts (portal accounts,
 * emailed by the invite mailer) and sponsored session slots.
 */
const done = (org: string, event: string) => {
  revalidatePath(`/o/${org}/e/${event}/sponsors/packages`);
  revalidatePath(`/o/${org}/e/${event}/sponsors`);
};

const invalid = (field: string, reason?: string): ProgramFormState => ({
  ok: false,
  code: 'validation_failed',
  fields: [field],
  ...(reason ? { reason } : {}),
});

/** `Title | sponsor | 14` per line (owner `sponsor` or `organizer`, days before the event). */
function parseTemplates(text: string) {
  const out: { title: string; owner: string; daysBefore: number }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [title = '', owner = '', days = ''] = line.split('|').map((p) => p.trim());
    const daysBefore = Number(days);
    if (!title || !(DELIVERABLE_OWNERS as readonly string[]).includes(owner.toLowerCase())) return null;
    if (!Number.isInteger(daysBefore) || daysBefore < 0) return null;
    out.push({ title, owner: owner.toLowerCase(), daysBefore });
  }
  return out;
}

export async function savePackageAction(
  org: string,
  event: string,
  tierId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  const priceText = String(form.get('price') ?? '').trim();
  let priceMinor: number | null = null;
  if (priceText) {
    try {
      priceMinor = moneyFromDecimal(priceText, ev.currency).amount;
    } catch {
      return invalid('price');
    }
  }
  const templates = parseTemplates(String(form.get('deliverables') ?? ''));
  if (!templates) return invalid('deliverables');
  const n = (k: string) => numberOrNull(form, k) ?? 0;
  try {
    await executeCommand(
      saveSponsorPackageCommand,
      {
        eventId: ev.id,
        tierId,
        description: String(form.get('description') ?? ''),
        priceMinor,
        quantity: numberOrNull(form, 'quantity'),
        onSale: form.get('onSale') === '1',
        compRegistrations: n('compRegistrations'),
        exhibitorBadges: n('exhibitorBadges'),
        leadLicenses: n('leadLicenses'),
        sessionSlots: n('sessionSlots'),
        logoPlacements: form
          .getAll('logoPlacements')
          .map(String)
          .filter((p) => (LOGO_PLACEMENTS as readonly string[]).includes(p)),
        deliverables: templates,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    const f = failure(err);
    // The price field is a decimal in the page; the command names it `priceMinor`.
    return f.fields?.includes('priceMinor')
      ? { ...f, fields: [...f.fields.filter((x) => x !== 'priceMinor'), 'price'] }
      : f;
  }
  done(org, event);
  return success();
}

export async function grantPackageAction(
  org: string,
  event: string,
  sponsorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  const tierId = String(form.get('tierId') ?? '');
  if (!tierId) return invalid('tierId');
  try {
    await executeCommand(
      grantSponsorPackageCommand,
      { eventId: ev.id, sponsorId, tierId, note: textOrNull(form, 'note') },
      data.ctx,
      ports,
    );
  } catch (err) {
    const f = failure(err);
    return { ...f, fields: f.fields ?? ['tierId'] };
  }
  done(org, event);
  return success();
}

export async function cancelGrantAction(org: string, event: string, grantId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  await executeCommand(cancelSponsorGrantCommand, { eventId: ev.id, grantId }, data.ctx, ports);
  done(org, event);
}

export async function setExhibitorAction(
  org: string,
  event: string,
  sponsorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  try {
    await executeCommand(
      setSponsorExhibitorCommand,
      { eventId: ev.id, sponsorId, exhibitorId: textOrNull(form, 'exhibitorId') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function inviteContactAction(
  org: string,
  event: string,
  sponsorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  try {
    await executeCommand(
      inviteSponsorContactCommand,
      { eventId: ev.id, sponsorId, email: String(form.get('email') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function resendContactAction(org: string, event: string, accountId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  await executeCommand(resendSponsorInviteCommand, { eventId: ev.id, accountId }, data.ctx, ports);
  done(org, event);
}

export async function revokeContactAction(org: string, event: string, accountId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  await executeCommand(revokeSponsorContactCommand, { eventId: ev.id, accountId }, data.ctx, ports);
  done(org, event);
}

export async function assignSessionAction(
  org: string,
  event: string,
  sponsorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  const sessionId = String(form.get('sessionId') ?? '');
  if (!sessionId) return invalid('sessionId');
  try {
    await executeCommand(
      assignSponsoredSessionCommand,
      { eventId: ev.id, sponsorId, sessionId },
      data.ctx,
      ports,
    );
  } catch (err) {
    const f = failure(err);
    return { ...f, fields: f.fields ?? ['sessionId'] };
  }
  done(org, event);
  return success();
}

export async function unassignSessionAction(org: string, event: string, sessionId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  await executeCommand(unassignSponsoredSessionCommand, { eventId: ev.id, sessionId }, data.ctx, ports);
  done(org, event);
}
