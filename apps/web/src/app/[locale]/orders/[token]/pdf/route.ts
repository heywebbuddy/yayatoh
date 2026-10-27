import { orderByManageToken } from '@yayatoh/orders';
import { getPdfRenderer } from '@/server/pdf.ts';
import { pdfLocale, ticketsPdfResponse } from '@/server/ticket-pdf.ts';

/**
 * The buyer's tickets as a tagged PDF, reached by the manage token (the credential). With
 * `?ticket={id}` just that ticket, as its own file.
 */
export async function GET(req: Request, { params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale: raw, token } = await params;
  const locale = pdfLocale(raw);
  const order = getPdfRenderer() ? await orderByManageToken(token) : null;
  if (!order) return new Response('Not found', { status: 404 });
  const only = new URL(req.url).searchParams.get('ticket');
  const picked = only ? order.tickets.filter((tk) => tk.id === only) : order.tickets;
  const date = order.tickets.find((tk) => tk.date)?.date ?? null;
  const first = picked[0];
  return ticketsPdfResponse({
    locale,
    event: order.event,
    // Multi-date events: an order's tickets are for one date (M1.4b); print that date.
    date,
    currency: order.currency,
    filename: only && first ? `ticket-${first.serial}.pdf` : 'tickets.pdf',
    tickets: picked.map((tk) => ({
      typeName: order.items.find((i) => i.ticketTypeId === tk.ticketTypeId)?.name ?? '',
      serial: tk.serial,
      shortCode: tk.shortCode,
      holderName: tk.holderName,
      purchaserName: order.buyerName,
      groupLabel: tk.groupLabel,
      tableNo: tk.tableNo,
      seatLabel: tk.seatLabel,
      code: tk.code,
    })),
  });
}
