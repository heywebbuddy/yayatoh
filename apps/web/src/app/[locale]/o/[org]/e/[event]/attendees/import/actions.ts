'use server';

import { attendeeImportBulk, stageImportCommand, validateImportCommand } from '@yayatoh/attendees';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const MAX_BYTES = 5_000_000;

const errorOf = (err: unknown) => {
  if (!isDomainError(err)) return 'internal';
  const reason = (err.details as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' ? `${err.code}:${reason}` : err.code;
};

/** Step 1: read the uploaded CSV and stage it; then the mapping step. */
export async function uploadImportAction(org: string, event: string, form: FormData): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'attendees');
  const locale = await getLocale();
  const base = `/o/${org}/e/${event}/attendees/import`;
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0)
    return redirect({ href: `${base}?error=validation_failed:empty`, locale });
  if (file.size > MAX_BYTES) return redirect({ href: `${base}?error=validation_failed:too_large`, locale });
  let batchId: string;
  try {
    ({ batchId } = await executeCommand(
      stageImportCommand,
      { eventId: ev.id, fileName: file.name || 'guests.csv', csv: await file.text() },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return redirect({ href: `${base}?error=${errorOf(err)}`, locale });
  }
  redirect({ href: `${base}?batch=${batchId}`, locale });
}

const col = (v: FormDataEntryValue | null) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

/** Step 2: apply the column mapping and check every row. */
export async function validateImportAction(org: string, event: string, batchId: string, form: FormData) {
  const { data, event: ev } = await loadEvent(org, event, 'attendees');
  const locale = await getLocale();
  const base = `/o/${org}/e/${event}/attendees/import?batch=${batchId}`;
  const extra = String(form.get('extraLabel') ?? '').trim();
  try {
    await executeCommand(
      validateImportCommand,
      {
        eventId: ev.id,
        batchId,
        mapping: {
          name: col(form.get('name')),
          email: col(form.get('email')),
          labels: col(form.get('labels')),
        },
        extraLabels: extra ? [extra] : [],
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return redirect({ href: `${base}&error=${errorOf(err)}`, locale });
  }
  redirect({ href: base, locale });
}

/** Step 3: import the valid rows (a bulk job; small files finish before the page loads). */
export async function startImportAction(org: string, event: string, batchId: string) {
  const { data, event: ev } = await loadEvent(org, event, 'attendees');
  const locale = await getLocale();
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      attendeeImportBulk.start,
      { eventId: ev.id, selection: { filter: { batchId } }, params: {} },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return redirect({
      href: `/o/${org}/e/${event}/attendees/import?batch=${batchId}&error=${errorOf(err)}`,
      locale,
    });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `/o/${org}/e/${event}/attendees?op=${operationId}&opk=import&batch=${batchId}`, locale });
}
