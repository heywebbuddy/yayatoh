'use server';

import { parseLinksText, SectionTextError } from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import {
  decideProfileChangeCommand,
  inviteExhibitorMemberCommand,
  resendExhibitorInviteCommand,
  revokeExhibitorMemberCommand,
  saveExhibitorListingCommand,
  saveExhibitorSettingsCommand,
} from '@yayatoh/program';
import { revalidatePath, updateTag } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { scopeTag } from '@/lib/cache-keys.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { newPortalLink, portalLinkUrl, sendPortalEmail } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';

/** The organizer's side of the exhibitor portal (M5.4a): settings, listings, people, approvals. */
const done = (org: string, event: string, orgId?: string) => {
  revalidatePath(`/o/${org}/e/${event}/exhibitors/portal`);
  revalidatePath(`/o/${org}/e/${event}/exhibitors`);
  // Listings and approved profiles show on the public exhibitor map (cached per org).
  if (orgId) updateTag(scopeTag({ org: orgId }));
};

export async function saveSettingsAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      saveExhibitorSettingsCommand,
      {
        eventId: ev.id,
        defaultStaffAllowance: numberOrNull(form, 'defaultStaffAllowance') ?? Number.NaN,
        approvalRequired: form.get('approvalRequired') === '1',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function saveListingAction(
  org: string,
  event: string,
  exhibitorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      saveExhibitorListingCommand,
      {
        eventId: ev.id,
        exhibitorId,
        listed: form.get('listed') === '1',
        categories: String(form.get('categories') ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        links: parseLinksText(String(form.get('links') ?? '')),
        staffAllowance: numberOrNull(form, 'staffAllowance'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    if (err instanceof SectionTextError)
      return { ok: false, code: 'validation_failed', fields: ['links'], reason: err.reason, line: err.line };
    return failure(err);
  }
  done(org, event, data.org.id);
  return success();
}

export async function inviteMemberAction(
  org: string,
  event: string,
  exhibitorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const locale = await getLocale();
  const link = newPortalLink();
  try {
    const role = form.get('role') === 'exhibitor_staff' ? 'exhibitor_staff' : 'exhibitor_admin';
    const r = await executeCommand(
      inviteExhibitorMemberCommand,
      { eventId: ev.id, exhibitorId, email: String(form.get('email') ?? ''), role, linkHash: link.hash },
      data.ctx,
      ports,
    );
    await sendPortalEmail({
      kind: 'portal.exhibitor-invite',
      to: r.member.email,
      locale,
      orgId: data.org.id,
      params: {
        url: await portalLinkUrl(data.org.id, r.member.id, link.secret, locale),
        eventName: r.eventName,
        exhibitorName: r.exhibitorName,
      },
    });
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function resendInviteAction(org: string, event: string, memberId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  const locale = await getLocale();
  const link = newPortalLink();
  const r = await executeCommand(
    resendExhibitorInviteCommand,
    { eventId: ev.id, memberId, linkHash: link.hash },
    data.ctx,
    ports,
  );
  await sendPortalEmail({
    kind: 'portal.exhibitor-invite',
    to: r.member.email,
    locale,
    orgId: data.org.id,
    params: {
      url: await portalLinkUrl(data.org.id, r.member.id, link.secret, locale),
      eventName: r.eventName,
      exhibitorName: r.exhibitorName,
    },
  });
  done(org, event);
}

export async function revokeMemberAction(org: string, event: string, memberId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(revokeExhibitorMemberCommand, { eventId: ev.id, memberId }, data.ctx, ports);
  done(org, event);
}

export async function decideChangeAction(
  org: string,
  event: string,
  changeId: string,
  decision: 'approve' | 'reject',
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      decideProfileChangeCommand,
      { eventId: ev.id, changeId, decision, reason: textOrNull(form, 'reason') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event, data.org.id);
  return success();
}
