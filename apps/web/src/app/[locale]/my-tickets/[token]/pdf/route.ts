import { withTenant } from '@yayatoh/db';
import { executeQuery } from '@yayatoh/kernel';
import { organizationNameTx } from '@yayatoh/tenancy';
import { holderContext, holderTicketsQuery } from '@yayatoh/ticketing';
import { getPdfRenderer } from '@/server/pdf.ts';
import { ports } from '@/server/ports.ts';
import { pdfLocale, ticketsPdfResponse } from '@/server/ticket-pdf.ts';

/**
 * A ticket holder's tickets as PDF, reached by their holder link (the credential). Without
 * `?ticket` every ticket the link holds; with it, that one ticket as its own file.
 */
export async function GET(req: Request, { params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale: raw, token: rawToken } = await params;
  const locale = pdfLocale(raw);
  if (!getPdfRenderer()) return new Response('Not found', { status: 404 });
  const h = await holderContext(decodeURIComponent(rawToken));
  if (!h) return new Response('Not found', { status: 404 });
  const data = await executeQuery(holderTicketsQuery, { linkId: h.id }, h.ctx, ports).catch(() => null);
  if (!data) return new Response('Not found', { status: 404 });
  const only = new URL(req.url).searchParams.get('ticket');
  const picked = only ? data.tickets.filter((tk) => tk.id === only) : data.tickets;
  const organizerName = h.ctx.orgId
    ? ((await withTenant(h.ctx, (tx) => organizationNameTx(tx, h.ctx.orgId as string))) ?? '')
    : '';
  const first = picked[0];
  return ticketsPdfResponse({
    locale,
    event: { ...data.event, organizerName },
    currency: 'USD',
    filename: only && first ? `ticket-${first.serial}.pdf` : 'tickets.pdf',
    tickets: picked.map((tk) => ({
      typeName: tk.typeName,
      serial: tk.serial,
      shortCode: tk.shortCode,
      holderName: tk.holderName,
      seatLabel: tk.seatLabel,
      code: tk.code,
    })),
  });
}
