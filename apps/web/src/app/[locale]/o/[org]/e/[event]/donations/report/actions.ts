'use server';

import {
  CRM_LAYOUTS,
  type CrmLayout,
  donorCsvExportBulk,
  donorXlsxExportBulk,
  EXPORT_FIELDS,
  LINE_METHODS,
  REPORT_SOURCES,
} from '@yayatoh/donations';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const path = (org: string, event: string) => `/o/${org}/e/${event}/donations/report`;

/**
 * Start the donor CRM export (M4.8g) in the chosen layout and format: a fresh step-up, then the
 * bulk operation (finished inline when small), then back to the report with its status.
 */
export async function exportDonorsAction(
  org: string,
  event: string,
  form: FormData,
): Promise<{ code: string } | undefined> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('donations.report.file');
  const rawLayout = String(form.get('layout') ?? 'generic');
  const layout: CrmLayout = (CRM_LAYOUTS as readonly string[]).includes(rawLayout)
    ? (rawLayout as CrmLayout)
    : 'generic';
  const xlsx = form.get('format') === 'xlsx';
  const labels = {
    headers: Object.fromEntries(EXPORT_FIELDS.map((f) => [f, t(`headers.${f}`)])) as Record<
      (typeof EXPORT_FIELDS)[number],
      string
    >,
    yes: t('yes'),
    no: t('no'),
    sources: Object.fromEntries(REPORT_SOURCES.map((s) => [s, t(`sources.${s}`)])) as Record<
      (typeof REPORT_SOURCES)[number],
      string
    >,
    methods: Object.fromEntries(LINE_METHODS.map((m) => [m, t(`methods.${m}`)])) as Record<
      (typeof LINE_METHODS)[number],
      string
    >,
  };
  const bulk = xlsx ? donorXlsxExportBulk : donorCsvExportBulk;
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      bulk.start,
      { eventId: ev.id, selection: { filter: {} }, params: { layout, labels } },
      data.ctx,
      ports,
    ));
  } catch (err) {
    const code = isDomainError(err) ? err.code : 'internal';
    if (code === 'step_up_required') return { code };
    return redirect({ href: `${path(org, event)}?exportError=${code}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${path(org, event)}?op=${operationId}&format=${xlsx ? 'xlsx' : 'csv'}`, locale });
}
