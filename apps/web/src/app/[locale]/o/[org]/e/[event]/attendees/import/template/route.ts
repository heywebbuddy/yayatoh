import { ATTENDEE_IMPORT_TEMPLATE } from '@yayatoh/attendees';
import { csvRow } from '@yayatoh/csv';
import { loadEvent } from '@/server/console.ts';

/** The attendee import starter sheet: the columns the import recognises, with two examples. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string }> },
) {
  const { org, event } = await params;
  const { can } = await loadEvent(org, event, 'attendees');
  if (!can('attendees:write'))
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const body = [ATTENDEE_IMPORT_TEMPLATE.headers, ...ATTENDEE_IMPORT_TEMPLATE.rows]
    .map((r) => csvRow(r))
    .join('');
  return new Response(`﻿${body}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="attendee-import-template.csv"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
