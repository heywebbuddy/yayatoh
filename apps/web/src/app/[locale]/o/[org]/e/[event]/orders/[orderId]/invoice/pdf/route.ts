import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { invoiceDocumentQuery } from '@yayatoh/orders';
import { roleCan } from '@yayatoh/tenancy';
import { z } from 'zod';
import { loadEvent } from '@/server/console.ts';
import { invoicePdfResponse, pdfLocale } from '@/server/invoice-pdf.ts';
import { ports } from '@/server/ports.ts';

/** An order's invoice as a PDF (M5.1d), in the viewer's language (`?locale=`). Anyone who can read orders. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; event: string; orderId: string }> },
) {
  const { org, event, orderId } = await params;
  const notFound = () => new Response('Not found', { status: 404 });
  if (!z.uuid().safeParse(orderId).success) return notFound();
  const { data, event: ev } = await loadEvent(org, event, 'ticketsOrders');
  if (!roleCan(data.role, 'orders:read')) return notFound();
  let doc: Awaited<ReturnType<typeof load>>;
  const load = () => executeQuery(invoiceDocumentQuery, { orderId }, data.ctx, ports);
  try {
    doc = await load();
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return notFound();
    throw err;
  }
  if (doc.eventId !== ev.id) return notFound();
  return invoicePdfResponse(doc, { locale: pdfLocale(req), seller: data.org.name, payUrl: null });
}
