import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { archiveFileQuery } from '@yayatoh/privacy';
import { loadConsole } from '@/server/console.ts';
import { zipResponse } from '@/server/dsar-receipt.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Download a data-subject archive (M6.1c): owners and admins of this org only (`privacy:manage`). */
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!UUID.test(id)) return notFound();
  const data = await loadConsole(org);
  try {
    return zipResponse(await executeQuery(archiveFileQuery, { requestId: id }, data.ctx, ports));
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
