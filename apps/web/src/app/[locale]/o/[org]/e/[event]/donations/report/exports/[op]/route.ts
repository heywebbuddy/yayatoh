import {
  DONOR_XLSX_CONTENT_TYPE,
  donorCsvExportBulk,
  donorXlsxExportBulk,
  donorXlsxFile,
} from '@yayatoh/donations';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * Download a finished donor CRM export (M4.8g): the CSV as stored, or the stored rows written as
 * an Excel workbook (`?format=xlsx`). The session's role must allow it (the queries' permission)
 * and the operation must belong to this event.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string; op: string }> },
) {
  const { org, event, op } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!/^[0-9a-f-]{36}$/.test(op)) return notFound();
  const xlsx = new URL(req.url).searchParams.get('format') === 'xlsx';
  const bulk = xlsx ? donorXlsxExportBulk : donorCsvExportBulk;
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    const status = await executeQuery(bulk.status, { operationId: op }, data.ctx, ports);
    if (status.eventId !== ev.id) return notFound();
    const file = await executeQuery(bulk.file, { operationId: op }, data.ctx, ports);
    const ascii = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const headers = {
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    if (!xlsx)
      return new Response(file.content, { headers: { ...headers, 'content-type': file.contentType } });
    const bytes = donorXlsxFile(file.content);
    return new Response(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      {
        headers: { ...headers, 'content-type': DONOR_XLSX_CONTENT_TYPE },
      },
    );
  } catch (err) {
    if (isDomainError(err) && ['not_found', 'forbidden', 'invalid_state'].includes(err.code))
      return notFound();
    throw err;
  }
}
