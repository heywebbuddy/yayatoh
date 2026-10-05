import { receiptDocumentQuery, receiptHtml } from '@yayatoh/donations';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { z } from 'zod';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { receiptPdfResponse } from '@/server/receipt-pdf.ts';

/**
 * A receipt as the host sees it (M4.8b): the same PDF the donor got, in the donor's language,
 * for anyone who reads orders. Without a renderer the same document comes back as printable HTML.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ org: string; event: string; receiptId: string }> },
) {
  const { org, event, receiptId } = await params;
  const notFound = () => new Response('Not found', { status: 404 });
  if (!z.uuid().safeParse(receiptId).success) return notFound();
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  if (!roleCan(data.role, 'orders:read')) return notFound();
  let doc: Awaited<ReturnType<typeof load>>;
  const load = () => executeQuery(receiptDocumentQuery, { receiptId }, data.ctx, ports);
  try {
    doc = await load();
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return notFound();
    throw err;
  }
  if (doc.eventId !== ev.id) return notFound();
  return receiptPdfResponse(receiptHtml(doc.doc, doc.locale), `receipt-${doc.doc.number}`);
}
