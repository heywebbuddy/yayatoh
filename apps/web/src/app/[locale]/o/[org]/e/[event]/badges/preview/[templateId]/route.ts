import { samplePreviewQuery } from '@yayatoh/badges';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { pdfResponse, renderOr503 } from '@/server/badge-pdf.ts';
import { loadBadgesPage } from '@/server/badges.ts';
import { ports } from '@/server/ports.ts';

/** A template printed with sample people (English or Arabic): anyone who can see the event. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; event: string; templateId: string }> },
) {
  const { org, event, templateId } = await params;
  const lang = new URL(req.url).searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const { data, ev } = await loadBadgesPage(org, event);
  let html: string;
  try {
    ({ html } = await executeQuery(
      samplePreviewQuery,
      { eventId: ev.id, templateId, lang },
      data.ctx,
      ports,
    ));
  } catch (err) {
    if (isDomainError(err)) return new Response('Not found', { status: 404 });
    throw err;
  }
  return renderOr503(html, (pdf) => pdfResponse(pdf, `badge-preview-${lang}.pdf`, 'inline'));
}
