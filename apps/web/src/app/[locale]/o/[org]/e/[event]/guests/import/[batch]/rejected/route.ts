import { GUEST_IMPORT_REJECTIONS, guestImportRejectedQuery } from '@yayatoh/guests';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { getTranslations } from 'next-intl/server';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** The rows a guest import could not take, with the reason in the host's language, as CSV (M4.1b). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string; batch: string }> },
) {
  const { org, event, batch } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!/^[0-9a-f-]{36}$/.test(batch)) return notFound();
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  const t = await getTranslations('guestImport');
  try {
    const r = await executeQuery(
      guestImportRejectedQuery,
      {
        eventId: ev.id,
        batchId: batch,
        reasonHeader: t('problemColumn'),
        reasons: Object.fromEntries(GUEST_IMPORT_REJECTIONS.map((c) => [c, t(`reason.${c}`)])),
      },
      data.ctx,
      ports,
    );
    const ascii = r.fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    return new Response(r.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.fileName)}`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    // Staff acting as a member never take files out (M1.2e).
    if (isDomainError(err) && err.code === 'impersonation_blocked')
      return new Response('Not available while acting as a member', {
        status: 403,
        headers: { 'cache-control': 'no-store' },
      });
    if (isDomainError(err) && ['not_found', 'forbidden'].includes(err.code)) return notFound();
    throw err;
  }
}
