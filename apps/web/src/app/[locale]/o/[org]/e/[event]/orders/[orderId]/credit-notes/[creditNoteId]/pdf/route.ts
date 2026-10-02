import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { creditNoteDocumentQuery } from '@yayatoh/orders';
import { creditNoteHtml } from '@yayatoh/pdf';
import { roleCan } from '@yayatoh/tenancy';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { routing } from '@/i18n/routing.ts';
import { loadEvent } from '@/server/console.ts';
import { getPdfRenderer } from '@/server/pdf.ts';
import { ports } from '@/server/ports.ts';

const RTL = new Set(['ar']);

/**
 * A credit note as a PDF (M3.10c), rendered by Gotenberg in the viewer's language (`?locale=`),
 * dates in the event's timezone. Anyone who can read orders; without a renderer the same document
 * comes back as printable HTML.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; event: string; orderId: string; creditNoteId: string }> },
) {
  const { org, event, orderId, creditNoteId } = await params;
  const notFound = () => new Response('Not found', { status: 404 });
  if (!z.uuid().safeParse(creditNoteId).success) return notFound();
  const { data, event: ev } = await loadEvent(org, event, 'ticketsOrders');
  if (!roleCan(data.role, 'orders:read')) return notFound();
  const requested = new URL(req.url).searchParams.get('locale') ?? 'en';
  const locale = (routing.locales as readonly string[]).includes(requested) ? requested : 'en';
  let doc: Awaited<ReturnType<typeof load>>;
  const load = () => executeQuery(creditNoteDocumentQuery, { creditNoteId }, data.ctx, ports);
  try {
    doc = await load();
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return notFound();
    throw err;
  }
  if (doc.orderId !== orderId || doc.eventId !== ev.id) return notFound();
  const t = await getTranslations({ locale, namespace: 'supportTools' });
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: doc.eventTimezone });
  const fmt = (minor: number) => formatMoney(money(minor, doc.currency), locale);
  const html = creditNoteHtml({
    lang: locale,
    dir: RTL.has(locale) ? 'rtl' : 'ltr',
    title: t('pdf.title', { label: doc.label }),
    seller: data.org.name,
    rows: [
      [t('pdf.number'), doc.label],
      [t('pdf.issued'), when.format(doc.createdAt)],
      [t('pdf.billedTo'), `${doc.buyerName} <${doc.buyerEmail}>`],
      [t('pdf.event'), doc.eventName],
      [
        t('pdf.order'),
        `${doc.orderId.replace(/-/g, '').slice(-8).toUpperCase()} · ${when.format(doc.orderCreatedAt)}`,
      ],
      [t('pdf.orderTotal'), fmt(doc.orderTotalMinor)],
      [t('pdf.kind'), t(`credit.kind.${doc.kind}`)],
      [t('pdf.settlement'), t(`credit.disposition.${doc.disposition}`)],
      ...(doc.disposition === 'store_credit' ? [[t('pdf.balance'), fmt(doc.balanceMinor)] as const] : []),
      [t('pdf.reason'), doc.reason],
    ],
    amountLabel: t('pdf.amount'),
    amount: fmt(doc.amountMinor),
    note: doc.disposition === 'store_credit' ? t('pdf.storeCreditNote') : t('pdf.refundedNote'),
    footer: t('pdf.footer', { seller: data.org.name }),
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
    console.error('credit note pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { ...headers, 'retry-after': '5' },
    });
  }
}
