'use server';

import {
  ATTENDEE_SOURCES,
  ATTENDEE_STATUSES,
  addGuestCommand,
  attendeeEmailBulk,
  attendeeImportBulk,
  attendeeLabelBulk,
  removeGuestCommand,
  setAttendeeLabelsCommand,
} from '@yayatoh/attendees';
import { DomainError, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { ticketCancelBulk } from '@yayatoh/orders';
import {
  ATTENDEE_EXPORT_COLUMNS,
  attendeeExportBulk,
  CHECKED_IN_FILTERS,
  matchingAttendeeIdsQuery,
} from '@yayatoh/reports';
import { type BulkAssignTarget, seatAssignBulk } from '@yayatoh/seating';
import { createClaimLinksCommand, revokeClaimLinkCommand, ticketResendBulk } from '@yayatoh/ticketing';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ClaimLinkState } from '@/components/claim-link-form.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type LabelState = { readonly ok: boolean; readonly code: string | null };

export async function addLabelAction(
  org: string,
  event: string,
  attendeeId: string,
  _prev: LabelState,
  form: FormData,
): Promise<LabelState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      setAttendeeLabelsCommand,
      { eventId: ev.id, attendeeIds: [attendeeId], add: [String(form.get('label') ?? '')] },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/attendees`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function removeLabelAction(
  org: string,
  event: string,
  attendeeId: string,
  label: string,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(
    setAttendeeLabelsCommand,
    { eventId: ev.id, attendeeIds: [attendeeId], remove: [label] },
    data.ctx,
    ports,
  );
  revalidatePath(`/o/${org}/e/${event}/attendees`);
}

export type BulkKind = 'label' | 'export' | 'import' | 'email' | 'seats' | 'resend' | 'cancel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "Assign seats": where to (the form's `bulkTarget`: best, item:…, section:… or group:…). */
function seatTarget(v: string): BulkAssignTarget | null {
  if (v === 'best') return { kind: 'best' };
  const [kind, ...rest] = v.split(':');
  const ref = rest.join(':');
  if (kind === 'item' && UUID.test(ref)) return { kind: 'item', itemId: ref };
  if (kind === 'section' && UUID.test(ref)) return { kind: 'section', sectionId: ref };
  if (kind === 'group' && ref.trim()) return { kind: 'group', label: ref };
  return null;
}

const pick = <T extends string>(list: readonly T[], v: FormDataEntryValue | null): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;

/** Back to the list as it was filtered (the form carries the filters), plus the outcome. */
function listQuery(form: FormData, extra: Record<string, string>): string {
  const q = new URLSearchParams();
  const add = (k: string, v: FormDataEntryValue | null) => {
    const s = String(v ?? '').trim();
    if (s) q.append(k, s);
  };
  add('q', form.get('f_q'));
  for (const l of form.getAll('f_label')) add('label', l);
  add('source', form.get('f_source'));
  add('status', form.get('f_status'));
  add('type', form.get('f_type'));
  add('checkin', form.get('f_checkin'));
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

/**
 * Start a bulk action on the selected attendees, or on everything matching the list's current
 * filters, run it for a few seconds inline, then show its progress panel.
 */
export async function bulkAction(
  org: string,
  event: string,
  form: FormData,
): Promise<{ code: string } | undefined> {
  const { data, event: ev } = await loadEvent(org, event);
  const locale = await getLocale();
  const base = `/o/${org}/e/${event}/attendees`;
  const what = String(form.get('bulk') ?? '');
  const kind: BulkKind =
    what === 'export'
      ? 'export'
      : what === 'email'
        ? 'email'
        : what === 'assignSeats'
          ? 'seats'
          : what === 'resend'
            ? 'resend'
            : what === 'cancelTickets'
              ? 'cancel'
              : 'label';
  const typeId = String(form.get('f_type') ?? '');
  const filter = {
    search: String(form.get('f_q') ?? '').trim() || undefined,
    labels: form.getAll('f_label').map(String),
    source: pick(ATTENDEE_SOURCES, form.get('f_source')),
    status: pick(ATTENDEE_STATUSES, form.get('f_status')),
    ticketTypeIds: UUID.test(typeId) ? [typeId] : [],
    checkedIn: pick(CHECKED_IN_FILTERS, form.get('f_checkin')),
  };
  const all = form.get('scope') === 'all';
  let operationId: string;
  try {
    // Exports take the list's whole filter. The other actions belong to lower tiers that know
    // only the attendee filters: ticket-type and check-in filters are resolved to ids here, and
    // a cancellation always runs on the exact people its confirmation counted.
    const byIds = async () =>
      all
        ? executeQuery(matchingAttendeeIdsQuery, { eventId: ev.id, filter }, data.ctx, ports)
        : form.getAll('ids').map(String);
    const extended = filter.ticketTypeIds.length > 0 || filter.checkedIn !== undefined;
    const { ticketTypeIds: _t, checkedIn: _c, ...basic } = filter;
    const selection: { filter?: typeof basic; ids?: string[] } =
      all && !extended ? { filter: basic } : { ids: await byIds() };
    if (kind === 'export') {
      const t = await getTranslations('exportColumns');
      ({ operationId } = await executeCommand(
        attendeeExportBulk.start,
        {
          eventId: ev.id,
          selection: all ? { filter } : selection,
          params: {
            headers: Object.fromEntries(ATTENDEE_EXPORT_COLUMNS.map((c) => [c, t(c)])),
            yes: t('yes'),
            no: t('no'),
          },
        },
        data.ctx,
        ports,
      ));
    } else if (kind === 'email') {
      ({ operationId } = await executeCommand(
        attendeeEmailBulk.start,
        {
          eventId: ev.id,
          selection,
          params: { subject: String(form.get('subject') ?? ''), body: String(form.get('message') ?? '') },
        },
        data.ctx,
        ports,
      ));
    } else if (kind === 'seats') {
      const target = seatTarget(String(form.get('bulkTarget') ?? ''));
      if (!target) throw new DomainError('validation_failed', 'Choose where to seat them');
      ({ operationId } = await executeCommand(
        seatAssignBulk.start,
        {
          eventId: ev.id,
          selection,
          params: {
            target,
            overrideRules: form.get('overrideRules') === 'on',
            // Per-date charts (M1.7g): the date whose chart they are seated on.
            occurrenceId: /^[0-9a-f-]{36}$/.test(String(form.get('bulkDate') ?? ''))
              ? String(form.get('bulkDate'))
              : null,
          },
        },
        data.ctx,
        ports,
      ));
    } else if (kind === 'resend') {
      ({ operationId } = await executeCommand(
        ticketResendBulk.start,
        { eventId: ev.id, selection, params: {} },
        data.ctx,
        ports,
      ));
    } else if (kind === 'cancel') {
      const ids = selection.ids ?? (await byIds());
      // The confirmation named a count: if the selection changed since, ask again.
      if (Number(form.get('confirmCount')) !== ids.length)
        throw new DomainError('invalid_state', 'The selection changed since it was confirmed');
      ({ operationId } = await executeCommand(
        ticketCancelBulk.start,
        { eventId: ev.id, selection: { ids }, params: {} },
        data.ctx,
        ports,
      ));
    } else {
      const label = String(form.get('bulkLabel') ?? '');
      ({ operationId } = await executeCommand(
        attendeeLabelBulk.start,
        {
          eventId: ev.id,
          selection,
          params: what === 'removeLabel' ? { remove: [label] } : { add: [label] },
        },
        data.ctx,
        ports,
      ));
    }
  } catch (err) {
    const code = isDomainError(err) ? err.code : 'internal';
    // Exports are step-up commands: the form asks the person to confirm and sends it again.
    if (code === 'step_up_required') return { code };
    return redirect({ href: `${base}?${listQuery(form, { bulkError: code })}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${base}?${listQuery(form, { op: operationId, opk: kind })}`, locale });
}

export async function undoBulkAction(
  org: string,
  event: string,
  kind: BulkKind,
  operationId: string,
): Promise<void> {
  const { data } = await loadEvent(org, event);
  await executeCommand(
    kind === 'import'
      ? attendeeImportBulk.undo
      : kind === 'seats'
        ? seatAssignBulk.undo
        : attendeeLabelBulk.undo,
    { operationId },
    data.ctx,
    ports,
  );
  await runBulkInline(data.org.id, operationId);
  revalidatePath(`/o/${org}/e/${event}/attendees`);
}

/** Send one ticket on with a claim link (emailed when an address is given; shown once). */
export async function sendTicketAction(
  org: string,
  event: string,
  ticketId: string,
  _prev: ClaimLinkState,
  form: FormData,
): Promise<ClaimLinkState> {
  const { data, event: ev } = await loadEvent(org, event);
  const email = String(form.get('email') ?? '').trim();
  try {
    const [link] = await executeCommand(
      createClaimLinksCommand,
      { eventId: ev.id, ticketIds: [ticketId], recipientEmail: email || undefined },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/attendees`);
    return link
      ? { kind: 'link', token: link.token, emailed: Boolean(email) }
      : { kind: 'error', code: 'internal' };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function revokeClaimAction(org: string, event: string, claimId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(revokeClaimLinkCommand, { eventId: ev.id, claimId }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/attendees`);
}

export type GuestState = { readonly ok: boolean; readonly code: string | null };

export async function addGuestAction(
  org: string,
  event: string,
  _prev: GuestState,
  form: FormData,
): Promise<GuestState> {
  const { data, event: ev } = await loadEvent(org, event);
  const label = String(form.get('label') ?? '').trim();
  try {
    await executeCommand(
      addGuestCommand,
      {
        eventId: ev.id,
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        labels: label ? [label] : [],
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/attendees`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function removeGuestAction(org: string, event: string, attendeeId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(removeGuestCommand, { eventId: ev.id, attendeeId }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/attendees`);
}
