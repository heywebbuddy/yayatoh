import { priceBreakdown } from '@yayatoh/billing';
import { withoutTenant } from '@yayatoh/db';
import { money } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { type PublicTicketTypeDto, publicTicketTypeSerializer } from './dto.ts';

type Row = {
  id: string;
  name: string;
  description: string | null;
  price_minor: string;
  currency: string;
  fee_mode: 'pass_on' | 'absorb';
  remaining: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
  min_per_order: number;
  max_per_order: number;
  percent_bps: number;
  fixed_minor: string;
};

/**
 * Public passes for an event page (cross-tenant by slug, SECURITY DEFINER). Every price is
 * all-in; inventory is reduced to an availability state plus a "few left" hint.
 */
export async function publicTicketTypes(
  eventSlug: string,
  now: Date = new Date(),
): Promise<PublicTicketTypeDto[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(sql`select * from ticketing.public_ticket_types(${eventSlug})`),
  );
  return rows.map((r) => {
    const p = priceBreakdown(
      money(Number(r.price_minor), r.currency),
      { percentBps: r.percent_bps, fixedMinor: Number(r.fixed_minor) },
      r.fee_mode,
    );
    const availability =
      r.sales_start_at && new Date(r.sales_start_at) > now
        ? 'not_yet_on_sale'
        : r.sales_end_at && new Date(r.sales_end_at) <= now
          ? 'sales_ended'
          : r.remaining <= 0
            ? 'sold_out'
            : 'available';
    return publicTicketTypeSerializer.serialize({
      id: r.id,
      name: r.name,
      description: r.description,
      currency: r.currency,
      allInMinor: p.allIn.amount,
      availability,
      fewLeft: availability === 'available' && r.remaining <= 10,
      minPerOrder: r.min_per_order,
      maxPerOrder: r.max_per_order,
    });
  });
}
