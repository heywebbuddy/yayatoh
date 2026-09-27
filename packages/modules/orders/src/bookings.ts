import { tenantQuery } from '@yayatoh/platform';
import { orderIdsByShortCodeTx } from '@yayatoh/ticketing';
import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SOLD_STATUSES } from './facts.ts';
import { ORDER_STATUSES } from './schema.ts';

/**
 * Booking filters (legacy: bookings, complimentary bookings, failed bookings). `paid` excludes
 * complimentary orders; `refunded` includes partial refunds; `box_office` is organizer-collected.
 */
export const BOOKING_FILTERS = [
  'all',
  'paid',
  'comp',
  'failed',
  'refunded',
  'pending',
  'expired',
  'box_office',
] as const;
export type BookingFilter = (typeof BOOKING_FILTERS)[number];

const list = (xs: readonly string[]) => sql.raw(xs.map((s) => `'${s}'`).join(', '));

const FILTER_SQL: Record<BookingFilter, SQL> = {
  all: sql`true`,
  paid: sql`o.status in ('paid', 'partially_refunded') and o.total_minor > 0`,
  comp: sql`o.status in (${list(SOLD_STATUSES)}) and o.total_minor = 0`,
  failed: sql`o.status = 'payment_failed'`,
  refunded: sql`o.status in ('refunded', 'partially_refunded')`,
  pending: sql`o.status in ('reserved', 'awaiting_payment')`,
  expired: sql`o.status in ('expired', 'cancelled')`,
  box_office: sql`o.collected_by = 'organizer'`,
};

export const BookingDto = z.object({
  id: z.uuid(),
  status: z.enum(ORDER_STATUSES),
  buyerName: z.string(),
  buyerEmail: z.string(),
  currency: z.string(),
  totalMinor: z.int(),
  tickets: z.int(),
  comp: z.boolean(),
  promoCode: z.string().nullable(),
  collectedBy: z.enum(['platform', 'organizer']),
  createdAt: z.date(),
  paidAt: z.date().nullable(),
});
export type BookingDto = z.infer<typeof BookingDto>;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Booking search for one event (M1.12): buyer name or email, an order reference (id prefix), a
 * promo code, or a ticket's printed code, with a status filter. Newest first; `total` is the
 * number of matches (the page shows at most `limit`).
 */
export const bookingSearchQuery = tenantQuery({
  name: 'orders.bookingSearch',
  input: z.object({
    eventId: z.uuid(),
    q: z.string().trim().max(200).default(''),
    filter: z.enum(BOOKING_FILTERS).default('all'),
    limit: z.int().min(1).max(200).default(50),
  }),
  output: z.object({ total: z.int(), items: z.array(BookingDto) }),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const where: SQL[] = [sql`o.event_id = ${input.eventId}::uuid`, FILTER_SQL[input.filter]];
    if (input.q) {
      const like = `%${escapeLike(input.q)}%`;
      const match: SQL[] = [sql`o.buyer_name ilike ${like}`, sql`o.buyer_email ilike ${like}`];
      if (/^[0-9a-f-]{8,36}$/i.test(input.q)) match.push(sql`o.id::text like ${`${input.q.toLowerCase()}%`}`);
      if (/^[A-Za-z0-9_-]{3,32}$/.test(input.q)) match.push(sql`o.promo_code = ${input.q.toUpperCase()}`);
      const byCode = await orderIdsByShortCodeTx(tx, input.eventId, input.q);
      if (byCode.length)
        match.push(
          sql`o.id in (${sql.join(
            byCode.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
      where.push(sql`(${sql.join(match, sql` or `)})`);
    }
    const cond = sql.join(where, sql` and `);
    const [count] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from orders.orders o where ${cond}`,
    );
    const rows = await tx.execute<Record<string, unknown>>(sql`
      select o.id, o.status, o.buyer_name, o.buyer_email, o.currency, o.total_minor, o.promo_code,
        o.collected_by, o.created_at, o.paid_at,
        coalesce((select sum(i.quantity) from orders.order_items i where i.order_id = o.id), 0)::int as tickets
      from orders.orders o where ${cond}
      order by o.created_at desc, o.id desc
      limit ${input.limit}`);
    const sold = new Set<string>(SOLD_STATUSES);
    return {
      total: Number(count?.n ?? 0),
      items: rows.map((r) => ({
        id: String(r.id),
        status: r.status as BookingDto['status'],
        buyerName: String(r.buyer_name),
        buyerEmail: String(r.buyer_email),
        currency: String(r.currency),
        totalMinor: Number(r.total_minor),
        tickets: Number(r.tickets),
        comp: sold.has(String(r.status)) && Number(r.total_minor) === 0,
        promoCode: (r.promo_code as string | null) ?? null,
        collectedBy: r.collected_by === 'organizer' ? ('organizer' as const) : ('platform' as const),
        createdAt: new Date(r.created_at as string),
        paidAt: r.paid_at ? new Date(r.paid_at as string) : null,
      })),
    };
  },
});
