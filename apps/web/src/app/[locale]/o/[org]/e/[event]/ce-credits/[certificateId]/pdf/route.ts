import { certificateDocumentQuery, certificateHtml } from '@yayatoh/ce';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { z } from 'zod';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { receiptPdfResponse } from '@/server/receipt-pdf.ts';
import { appOrigin } from '@/server/tenant-return.ts';

/**
 * A CE certificate as the organizer sees it (M6.9b): the same PDF the holder got, in the holder's
 * language, for event readers. Without a renderer the same document comes back as printable HTML.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ org: string; event: string; certificateId: string }> },
) {
  const { org, event, certificateId } = await params;
  const notFound = () => new Response('Not found', { status: 404 });
  if (!z.uuid().safeParse(certificateId).success) return notFound();
  const { data, event: ev, can } = await loadEvent(org, event, 'ceCredits');
  if (!data.modules.has('virtual') || !can('events:read')) return notFound();
  try {
    const doc = await executeQuery(
      certificateDocumentQuery(appOrigin()),
      { eventId: ev.id, certificateId },
      data.ctx,
      ports,
    );
    return receiptPdfResponse(certificateHtml(doc.doc, doc.locale), `certificate-${doc.doc.code}`);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return notFound();
    throw err;
  }
}
