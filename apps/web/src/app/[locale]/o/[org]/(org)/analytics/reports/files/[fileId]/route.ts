import { reportFileQuery } from '@yayatoh/analytics';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * A scheduled report's PDF (M6.2b), for members of the org who can read orders; a PDF with
 * revenue only for members who can see finance. The link in the report email lands here (sign-in
 * first), so the PDF never travels as an attachment. Never cached.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; fileId: string }> }) {
  const { org, fileId } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const data = await loadConsole(org);
  if (!data.modules.has('analytics_pro') || !roleCan(data.role, 'orders:read')) return notFound();
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return notFound();
  try {
    const f = await executeQuery(reportFileQuery, { fileId }, data.ctx, ports);
    return new Response(new Uint8Array(f.pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex',
      },
    });
  } catch (err) {
    if (isDomainError(err) && ['not_found', 'forbidden', 'module_not_enabled'].includes(err.code))
      return notFound();
    throw err;
  }
}
