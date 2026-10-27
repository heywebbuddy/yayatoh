import { RTL_LOCALES } from '@yayatoh/contracts';
import { orderByManageToken } from '@yayatoh/orders';
import { invoiceHtml } from '@yayatoh/pdf';
import { getPdfRenderer } from '@/server/pdf.ts';
import { buildReceipt, receiptEligible } from '@/server/receipt.ts';
import { pdfLocale } from '@/server/ticket-pdf.ts';

/** The buyer's receipt as a PDF, reached by the manage token (the credential). */
export async function GET(_req: Request, { params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale: raw, token } = await params;
  const locale = pdfLocale(raw);
  const order = await orderByManageToken(token);
  if (!order || !receiptEligible(order)) return new Response('Not found', { status: 404 });
  const r = await buildReceipt(order, locale);
  const html = invoiceHtml({
    lang: locale,
    dir: RTL_LOCALES.has(locale as 'ar') ? 'rtl' : 'ltr',
    title: r.title,
    seller: r.seller,
    rows: r.rows,
    lineHeads: r.lineHeads,
    lines: r.lines,
    totals: r.totals,
    paymentsTitle: r.paymentsTitle,
    payments: r.payments,
    note: r.note,
    footer: r.footer,
  });
  const headers = {
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
    'referrer-policy': 'no-referrer',
  };
  const renderer = getPdfRenderer();
  // Without a renderer the receipt comes back as printable HTML.
  if (!renderer)
    return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  try {
    const bytes = new Uint8Array(await renderer.render({ html }));
    return new Response(bytes, {
      headers: {
        ...headers,
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${r.number}.pdf"`,
      },
    });
  } catch (err) {
    console.error('receipt pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { ...headers, 'retry-after': '5' },
    });
  }
}
