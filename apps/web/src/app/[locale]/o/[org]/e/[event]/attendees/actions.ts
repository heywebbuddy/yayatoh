'use server';

import {
  ATTENDEE_SOURCES,
  ATTENDEE_STATUSES,
  attendeeLabelBulk,
  setAttendeeLabelsCommand,
} from '@yayatoh/attendees';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { ATTENDEE_EXPORT_COLUMNS, attendeeExportBulk } from '@yayatoh/reports';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
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

export type BulkKind = 'label' | 'export';

const pick = <T extends string>(list: readonly T[], v: FormDataEntryValue | null): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;

/**
 * Start a bulk action on the selected attendees, or on everything matching the list's current
 * filters, run it for a few seconds inline, then show its progress panel.
 */
export async function bulkAction(org: string, event: string, form: FormData): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  const locale = await getLocale();
  const base = `/o/${org}/e/${event}/attendees`;
  const what = String(form.get('bulk') ?? '');
  const kind: BulkKind = what === 'export' ? 'export' : 'label';
  const selection =
    form.get('scope') === 'all'
      ? {
          filter: {
            search: String(form.get('f_q') ?? '').trim() || undefined,
            labels: form.getAll('f_label').map(String),
            source: pick(ATTENDEE_SOURCES, form.get('f_source')),
            status: pick(ATTENDEE_STATUSES, form.get('f_status')),
          },
        }
      : { ids: form.getAll('ids').map(String) };
  let operationId: string;
  try {
    if (kind === 'export') {
      const t = await getTranslations('exportColumns');
      ({ operationId } = await executeCommand(
        attendeeExportBulk.start,
        {
          eventId: ev.id,
          selection,
          params: {
            headers: Object.fromEntries(ATTENDEE_EXPORT_COLUMNS.map((c) => [c, t(c)])),
            yes: t('yes'),
            no: t('no'),
          },
        },
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
    return redirect({ href: `${base}?bulkError=${code}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${base}?op=${operationId}&opk=${kind}`, locale });
}

export async function undoBulkAction(org: string, event: string, operationId: string): Promise<void> {
  const { data } = await loadEvent(org, event);
  await executeCommand(attendeeLabelBulk.undo, { operationId }, data.ctx, ports);
  await runBulkInline(data.org.id, operationId);
  revalidatePath(`/o/${org}/e/${event}/attendees`);
}
