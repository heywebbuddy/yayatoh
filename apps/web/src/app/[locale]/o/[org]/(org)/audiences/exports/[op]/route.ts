import { audienceExportBulk } from '@yayatoh/audiences';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** Download a finished audience export (the query's permission and category apply). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; op: string }> },
) {
  const { org, op } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!/^[0-9a-f-]{36}$/.test(op)) return notFound();
  const data = await loadConsole(org);
  try {
    const file = await executeQuery(audienceExportBulk.file, { operationId: op }, data.ctx, ports);
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
    if (isDomainError(err) && err.code === 'impersonation_blocked')
      return new Response('Not available while acting as a member', {
        status: 403,
        headers: { 'cache-control': 'no-store' },
      });
    if (isDomainError(err) && ['not_found', 'forbidden', 'invalid_state'].includes(err.code))
      return notFound();
    throw err;
  }
}
