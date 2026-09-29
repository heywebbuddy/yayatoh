import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { waitlistExportBulk } from '@yayatoh/orders';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * Download a finished waitlist export. The session's org role must allow exports (the query's
 * permission), and the operation must belong to this event.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string; op: string }> },
) {
  const { org, event, op } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!/^[0-9a-f-]{36}$/.test(op)) return notFound();
  const { data, event: ev } = await loadEvent(org, event);
  try {
    const status = await executeQuery(waitlistExportBulk.status, { operationId: op }, data.ctx, ports);
    if (status.eventId !== ev.id) return notFound();
    const file = await executeQuery(waitlistExportBulk.file, { operationId: op }, data.ctx, ports);
    const ascii = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    return new Response(file.content, {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    if (isDomainError(err) && ['not_found', 'forbidden', 'invalid_state'].includes(err.code))
      return notFound();
    throw err;
  }
}
