import { browserJobBadgeQuery } from '@yayatoh/badges';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { pdfResponse, renderOr503 } from '@/server/badge-pdf.ts';
import { loadBadgesPage } from '@/server/badges.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A browser print job's badge (M5.5b): the PDF the desk prints from its print dialog (AirPrint or
 * any printer). Only for a logged job, and only for 30 minutes after it: every printed badge is
 * in the print log.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string; jobId: string }> },
) {
  const { org, event, jobId } = await params;
  if (!UUID.test(jobId)) return new Response('Not found', { status: 404 });
  const { data, ev } = await loadBadgesPage(org, event);
  let html: string;
  try {
    const badge = await executeQuery(browserJobBadgeQuery, { jobId }, data.ctx, ports);
    if (badge.eventId !== ev.id) return new Response('Not found', { status: 404 });
    ({ html } = badge);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return new Response(err.code === 'forbidden' ? 'Forbidden' : 'Not found', {
      status: err.code === 'forbidden' ? 403 : 404,
    });
  }
  return renderOr503(html, (pdf) => pdfResponse(pdf, 'badge.pdf', 'inline'));
}
