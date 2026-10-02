import { singleBadgeQuery } from '@yayatoh/badges';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { pdfResponse, renderOr503 } from '@/server/badge-pdf.ts';
import { loadBadgesPage } from '@/server/badges.ts';
import { ports } from '@/server/ports.ts';

/** One badge, for printing at the desk (AirPrint or the browser's print dialog). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string; ticketId: string }> },
) {
  const { locale, org, event, ticketId } = await params;
  const { data, ev } = await loadBadgesPage(org, event);
  let html: string;
  try {
    ({ html } = await executeQuery(singleBadgeQuery, { eventId: ev.id, ticketId, locale }, data.ctx, ports));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return new Response(err.code === 'forbidden' ? 'Forbidden' : 'Not found', {
      status: err.code === 'forbidden' ? 403 : 404,
    });
  }
  return renderOr503(html, (pdf) => pdfResponse(pdf, 'badge.pdf', 'inline'));
}
