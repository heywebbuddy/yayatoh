import 'server-only';
import { formatMoney, money } from '@yayatoh/kernel';
import type { InvoiceDocumentDto, PublicInvoiceDto } from '@yayatoh/orders';
import { invoiceHtml } from '@yayatoh/pdf';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';
import { getPdfRenderer } from '@/server/pdf.ts';

const RTL = new Set(['ar']);

/** The locale asked for in `?locale=`, if the app has it. */
export function pdfLocale(req: Request): string {
  const requested = new URL(req.url).searchParams.get('locale') ?? 'en';
  return (routing.locales as readonly string[]).includes(requested) ? requested : 'en';
}

/**
 * An invoice as a PDF (M5.1d), rendered by Gotenberg in the reader's language, money in the
 * invoice's currency and the due date as a calendar day. The same document for the organizer and
 * for the buyer (whose copy carries their pay link). Without a renderer the document comes back as
 * printable HTML.
 */
export async function invoicePdfResponse(
  doc: InvoiceDocumentDto | PublicInvoiceDto,
  opts: { locale: string; seller: string; payUrl: string | null },
): Promise<Response> {
  const { locale } = opts;
  const t = await getTranslations({ locale, namespace: 'invoices' });
  const fmt = (minor: number) => formatMoney(money(minor, doc.currency), locale);
  const day = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(`${d}T00:00:00Z`),
    );
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: doc.eventTimezone });
  const html = invoiceHtml({
    lang: locale,
    dir: RTL.has(locale) ? 'rtl' : 'ltr',
    title: t('pdf.title', { label: doc.label }),
    seller: opts.seller,
    rows: [
      [t('panel.number'), doc.label],
      [t('panel.issued'), day(doc.issuedOn)],
      [t('panel.due'), day(doc.dueOn)],
      [t('panel.terms'), t('panel.termsValue')],
      ...(doc.poNumber ? [[t('panel.po'), doc.poNumber] as const] : []),
      [t('pdf.billedTo'), `${doc.buyerName} <${doc.buyerEmail}>`],
      ...(doc.billingCompany ? [[t('panel.company'), doc.billingCompany] as const] : []),
      [t('pdf.event'), `${doc.eventName} · ${when.format(doc.eventStartsAt)}`],
      [t('pdf.status'), t(`status.${doc.status}`)],
    ],
    lineHeads: [t('pdf.item'), t('pdf.quantity'), t('pdf.unit'), t('pdf.amount')],
    lines: doc.lines.map((l) => [l.name, String(l.quantity), fmt(l.unitMinor), fmt(l.totalMinor)]),
    totals: [
      [t('panel.total'), fmt(doc.totalMinor)],
      [t('panel.paid'), fmt(doc.paidMinor)],
      [t('panel.balance'), fmt(doc.balanceMinor)],
    ],
    paymentsTitle: t('panel.payments'),
    payments: doc.payments.map((p) => [
      [
        p.receivedOn ? day(p.receivedOn) : p.completedAt ? when.format(p.completedAt) : '',
        t(`methods.${p.method}`),
      ]
        .filter(Boolean)
        .join(' · '),
      fmt(p.amountMinor),
    ]),
    note:
      doc.status === 'open'
        ? opts.payUrl
          ? t('pdf.payNote', { url: opts.payUrl })
          : t('pdf.payNoteNoLink')
        : doc.status === 'paid'
          ? t('pdf.paidNote')
          : t('pdf.voidNote'),
    footer: t('pdf.footer', { seller: opts.seller }),
  });
  const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };
  const renderer = getPdfRenderer();
  if (!renderer)
    return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  try {
    const bytes = new Uint8Array(await renderer.render({ html }));
    return new Response(bytes, {
      headers: {
        ...headers,
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${doc.label}.pdf"`,
      },
    });
  } catch (err) {
    console.error('invoice pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { ...headers, 'retry-after': '5' },
    });
  }
}
