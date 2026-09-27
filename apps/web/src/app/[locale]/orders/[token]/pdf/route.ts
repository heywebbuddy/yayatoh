import { RTL_LOCALES } from '@yayatoh/contracts';
import { orderByManageToken } from '@yayatoh/orders';
import { ticketsHtml } from '@yayatoh/pdf';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { getPdfRenderer } from '@/server/pdf.ts';

/** The buyer's tickets as a tagged PDF, reached by the manage token (the credential). */
export async function GET(_req: Request, { params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale: raw, token } = await params;
  const locale = routing.locales.find((l) => l === raw) ?? routing.defaultLocale;
  const renderer = getPdfRenderer();
  const order = renderer ? await orderByManageToken(token) : null;
  if (!renderer || !order || order.tickets.length === 0) return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale });
  const ev = order.event;
  const date = order.tickets.find((tk) => tk.date)?.date ?? null;
  let pdf: Uint8Array;
  try {
    pdf = await renderer.render({
      html: ticketsHtml({
        lang: locale,
        dir: RTL_LOCALES.has(locale) ? 'rtl' : 'ltr',
        eventName: ev.name,
        // Multi-date events: an order's tickets are for one date (M1.4b); print that date.
        when: formatEventDateRange((date ?? ev).startsAt.toISOString(), (date ?? ev).endsAt.toISOString(), {
          locale,
          currency: order.currency,
          timeZone: ev.timezone,
        }),
        where: [ev.venueName, ev.city].filter(Boolean).join(', ') || null,
        organizer: ev.organizerName,
        tickets: order.tickets.map((tk) => ({
          typeName: order.items.find((i) => i.ticketTypeId === tk.ticketTypeId)?.name ?? '',
          serialLabel: t('order.serial', { serial: tk.serial }),
          shortCode: tk.shortCode,
          holderName: tk.holderName,
          seatLabel: tk.seatLabel,
          code: tk.code,
          qrLabel: t('order.qrLabel', { serial: tk.serial }),
        })),
        labels: {
          code: t('order.shortCode'),
          holder: t('order.holder'),
          seat: t('order.seat'),
          footer: t('order.ticketsHint'),
        },
      }),
    });
  } catch (err) {
    // The renderer is a separate service: when it is down or cold, ask the buyer to retry.
    console.error('ticket pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { 'retry-after': '5', 'cache-control': 'no-store' },
    });
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline; filename="tickets.pdf"',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
    },
  });
}
