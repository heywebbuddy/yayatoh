import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { isDomainError } from '@yayatoh/kernel';
import { publicInvoice } from '@yayatoh/orders';
import { invoicePdfResponse, pdfLocale } from '@/server/invoice-pdf.ts';

/**
 * The buyer's invoice as a PDF (M5.1d, by its signed link), in their language (`?locale=`), with
 * their pay link while something is due. The org comes from the event's slug.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const notFound = () => new Response('Not found', { status: 404 });
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) return notFound();
  let doc: Awaited<ReturnType<typeof publicInvoice>>;
  try {
    doc = await publicInvoice(target.orgId, target.eventId, token);
  } catch (err) {
    if (isDomainError(err)) return notFound();
    throw err;
  }
  const locale = pdfLocale(req);
  const origin = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
  return invoicePdfResponse(doc, {
    locale,
    seller: ev.organizerName ?? ev.name,
    payUrl: `${origin}${locale === 'en' ? '' : `/${locale}`}/events/${slug}/invoice/${token}`,
  });
}
