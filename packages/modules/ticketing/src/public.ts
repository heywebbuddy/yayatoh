import { priceBreakdown } from '@yayatoh/billing';
import { withoutTenant } from '@yayatoh/db';
import { money } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { type PublicTicketTypeDto, publicTicketTypeSerializer } from './dto.ts';
import { currentFaceMinor } from './inventory.ts';

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
  early_price_minor: string | null;
  early_ends_at: string | null;
  is_donation: boolean;
  access_dates: { date: string; name: string }[];
  unlocked: boolean;
};

/**
 * Public passes for an event page (cross-tenant by slug, SECURITY DEFINER). Every price is
 * all-in; inventory is reduced to an availability state plus a "few left" hint. `access` is what a
 * verified access code grants (M1.4d): hidden passes it unlocked, and a private event it opened.
 */
export async function publicTicketTypes(
  eventSlug: string,
  now: Date = new Date(),
  access: { readonly unlocked?: readonly string[]; readonly privateOk?: boolean } = {},
): Promise<PublicTicketTypeDto[]> {
  const unlocked = `{${(access.unlocked ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(',')}}`;
  const privateOk = access.privateOk === true;
  const [rows, dates, tables] = await withoutTenant(async (tx) => [
    await tx.execute<Row>(
      sql`select * from ticketing.public_ticket_types_v3(${eventSlug}, ${unlocked}::uuid[], ${privateOk})`,
    ),
    await tx.execute<{ id: string; occurrence_ids: string[] }>(
      sql`select * from ticketing.public_ticket_type_occurrences_v2(${eventSlug}, ${unlocked}::uuid[], ${privateOk})`,
    ),
    // M4.2b: seats per table of the event's table tickets.
    await tx.execute<{ id: string; table_size: number }>(
      sql`select * from ticketing.public_ticket_type_tables(${eventSlug}, ${unlocked}::uuid[], ${privateOk})`,
    ),
  ]);
  const tableSizes = new Map(tables.map((t) => [t.id, t.table_size]));
  const occurrenceIds = new Map(dates.map((d) => [d.id, d.occurrence_ids]));
  return rows.map((r) => {
    const allIn = (face: number) =>
      priceBreakdown(
        money(face, r.currency),
        { percentBps: r.percent_bps, fixedMinor: Number(r.fixed_minor) },
        r.fee_mode,
      ).allIn.amount;
    const earlyEndsAt = r.early_ends_at ? new Date(r.early_ends_at) : null;
    const face = currentFaceMinor(
      {
        priceMinor: Number(r.price_minor),
        earlyPriceMinor: r.early_price_minor === null ? null : Number(r.early_price_minor),
        earlyEndsAt,
      },
      now,
    );
    const earlyRunning = face !== Number(r.price_minor);
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
      allInMinor: allIn(face),
      regularAllInMinor: earlyRunning ? allIn(Number(r.price_minor)) : null,
      earlyEndsAt: earlyRunning ? earlyEndsAt : null,
      isDonation: r.is_donation,
      accessDates: r.access_dates,
      occurrenceIds: occurrenceIds.get(r.id) ?? [],
      availability,
      fewLeft: availability === 'available' && r.remaining <= 10,
      minPerOrder: r.min_per_order,
      maxPerOrder: r.max_per_order,
      unlocked: r.unlocked,
      tableSize: tableSizes.get(r.id) ?? null,
    });
  });
}
