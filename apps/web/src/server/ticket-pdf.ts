import { RTL_LOCALES } from '@yayatoh/contracts';
import { ticketsHtml } from '@yayatoh/pdf';
import { zipSync } from 'fflate';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';
import { formatEventDateTimeRange } from '@/lib/format.ts';
import { getPdfRenderer } from '@/server/pdf.ts';

export interface TicketPdfEvent {
  readonly name: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timezone: string;
  readonly venueName?: string | null;
  readonly city?: string | null;
  readonly organizerName: string;
}

export interface TicketPdfTicket {
  readonly typeName: string;
  readonly serial: number;
  readonly shortCode: string;
  readonly holderName: string;
  readonly purchaserName?: string | null;
  readonly groupLabel?: string | null;
  readonly tableNo?: number | null;
  readonly seatLabel?: string | null;
  readonly code: string;
}

/** The locale a request asked for, or the default. */
export const pdfLocale = (raw: string) => routing.locales.find((l) => l === raw) ?? routing.defaultLocale;

/**
 * Ticket PDF pages as a response: all of a buyer's tickets, or one ticket (its own file). The
 * route has already checked the credential (manage or holder token) and chose the tickets.
 */
interface TicketsPdfArgs {
  locale: string;
  event: TicketPdfEvent;
  /** The event's date for this order (multi-date events), when it is not the event's own. */
  date?: { startsAt: Date; endsAt: Date } | null;
  currency: string;
  tickets: readonly TicketPdfTicket[];
  filename: string;
}

const unavailable = (err: unknown) => {
  // The renderer is a separate service: when it is down or cold, ask the buyer to retry.
  console.error('ticket pdf', err);
  return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
    status: 503,
    headers: { 'retry-after': '5', 'cache-control': 'no-store' },
  });
};

const FILE_HEADERS = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
  'referrer-policy': 'no-referrer',
};

/**
 * "Download all" as separate files: a ZIP with one PDF per ticket (`ticket-{serial}.pdf`). The
 * combined PDF stays available as `ticketsPdfResponse`.
 */
export async function ticketsZipResponse(a: TicketsPdfArgs): Promise<Response> {
  if (!getPdfRenderer() || a.tickets.length === 0) return new Response('Not found', { status: 404 });
  try {
    const files: Record<string, Uint8Array> = {};
    for (const tk of a.tickets) {
      const r = await ticketsPdfResponse({ ...a, tickets: [tk], filename: `ticket-${tk.serial}.pdf` });
      if (!r.ok) return r;
      files[`ticket-${tk.serial}.pdf`] = new Uint8Array(await r.arrayBuffer());
    }
    return new Response(new Uint8Array(zipSync(files, { level: 0 })), {
      headers: {
        ...FILE_HEADERS,
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="tickets.zip"',
      },
    });
  } catch (err) {
    return unavailable(err);
  }
}

export async function ticketsPdfResponse(a: TicketsPdfArgs): Promise<Response> {
  const renderer = getPdfRenderer();
  if (!renderer || a.tickets.length === 0) return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale: a.locale });
  const ev = a.event;
  const when = a.date ?? ev;
  let pdf: Uint8Array;
  try {
    pdf = await renderer.render({
      html: ticketsHtml({
        lang: a.locale,
        dir: RTL_LOCALES.has(a.locale as 'ar') ? 'rtl' : 'ltr',
        eventName: ev.name,
        when: formatEventDateTimeRange(when.startsAt.toISOString(), when.endsAt.toISOString(), {
          locale: a.locale,
          currency: a.currency,
          timeZone: ev.timezone,
        }),
        where: [ev.venueName, ev.city].filter(Boolean).join(', ') || null,
        organizer: ev.organizerName,
        tickets: a.tickets.map((tk) => ({
          typeName: tk.typeName,
          serialLabel: t('order.serial', { serial: tk.serial }),
          shortCode: tk.shortCode,
          holderName: tk.holderName,
          purchaserName: tk.purchaserName ?? null,
          groupLabel: tk.groupLabel ?? null,
          tableLabel: tk.tableNo ? t('order.tableNo', { n: tk.tableNo }) : null,
          seatLabel: tk.seatLabel ?? null,
          code: tk.code,
          qrLabel: t('order.qrLabel', { serial: tk.serial }),
        })),
        labels: {
          code: t('order.shortCode'),
          holder: t('order.holder'),
          purchaser: t('order.purchaser'),
          group: t('order.group'),
          table: t('order.table'),
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
      'content-disposition': `inline; filename="${a.filename}"`,
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
    },
  });
}
