import { csvRow } from '@yayatoh/csv';
import { GUEST_IMPORT_TEMPLATE } from '@yayatoh/guests';
import { loadEvent } from '@/server/console.ts';

/**
 * The guest-list starter sheet (agreement §5: CSV/Excel guest import): the columns the import
 * recognises and example households, as a CSV that Excel, Numbers and Google Sheets open.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string }> },
) {
  const { org, event } = await params;
  const { data, can } = await loadEvent(org, event, 'seating');
  if (!data.modules.has('guests') || !can('guests:write'))
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const body = [GUEST_IMPORT_TEMPLATE.headers, ...GUEST_IMPORT_TEMPLATE.rows].map((r) => csvRow(r)).join('');
  return new Response(`﻿${body}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="guest-list-template.csv"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
