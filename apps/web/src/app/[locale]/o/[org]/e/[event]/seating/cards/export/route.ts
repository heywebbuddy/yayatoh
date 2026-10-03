import { csvRow, writeXlsx, XLSX_CONTENT_TYPE } from '@yayatoh/csv';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  exportGuestSeatingCommand,
  isExportFormat,
  isExportKind,
  mealCounts,
  mealCountsTable,
  nameSheet,
  seatingChartTable,
} from '@yayatoh/seating';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { download, exportCopy, placeNamer } from '@/server/seating-cards.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The seating chart by table or the caterer's meal counts (M4.3b) as CSV or XLSX:
 * `?kind=chart|meals&format=csv|xlsx&sub=<sub-event>`, headers in the reader's language. An export
 * of the guest list: `attendees:export` (planners and viewers get a 404), audited by the command.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string }> },
) {
  const { locale, org, event } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  if (!data.modules.has('guests') || !can('attendees:export')) return notFound();
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind') ?? '';
  const format = q.get('format') ?? '';
  const sub = q.get('sub') || null;
  if (!isExportKind(kind) || !isExportFormat(format) || (sub && !UUID.test(sub)))
    return new Response('Choose the chart or the meal counts, as CSV or XLSX.', {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  let out: Awaited<ReturnType<typeof run>>;
  const run = () =>
    executeCommand(
      exportGuestSeatingCommand,
      { eventId: ev.id, subEventId: sub, kind, format },
      data.ctx,
      ports,
    );
  try {
    out = await run();
  } catch (err) {
    if (isDomainError(err) && ['not_found', 'forbidden', 'module_not_enabled'].includes(err.code))
      return notFound();
    throw err;
  }
  const copy = await exportCopy(locale);
  // Places under the names the reader knows ("Table 3"); counts per place as the command gave them.
  const sheet = nameSheet(out.sheet, await placeNamer(locale));
  const rows = kind === 'chart' ? seatingChartTable(sheet, copy) : mealCountsTable(mealCounts(sheet), copy);
  const name = `${ev.slug}-${kind === 'chart' ? 'seating-chart' : 'meal-counts'}`;
  if (format === 'csv')
    // A BOM so spreadsheet apps read UTF-8 (accents, Arabic, CJK).
    return download(`﻿${rows.map(csvRow).join('')}`, 'text/csv; charset=utf-8', `${name}.csv`);
  const bytes = writeXlsx([{ name: kind === 'chart' ? copy.sheetChart : copy.sheetMeals, rows }]);
  return download(new Uint8Array(bytes), XLSX_CONTENT_TYPE, `${name}.xlsx`);
}
