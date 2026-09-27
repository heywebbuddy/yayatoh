import type { TenantTx } from '@yayatoh/db';
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

/** What a booking search or export selects: one event, a text query and a filter. */
export const BookingSelection = z.object({
  q: z.string().trim().max(200).default(''),
  filter: z.enum(BOOKING_FILTERS).default('all'),
});
export type BookingSelection = z.output<typeof BookingSelection>;

async function whereTx(tx: TenantTx, eventId: string, sel: BookingSelection): Promise<SQL> {
  const where: SQL[] = [sql`o.event_id = ${eventId}::uuid`, FILTER_SQL[sel.filter]];
  if (sel.q) {
    const like = `%${escapeLike(sel.q)}%`;
    const match: SQL[] = [sql`o.buyer_name ilike ${like}`, sql`o.buyer_email ilike ${like}`];
    if (/^[0-9a-f-]{8,36}$/i.test(sel.q)) match.push(sql`o.id::text like ${`${sel.q.toLowerCase()}%`}`);
    if (/^[A-Za-z0-9_-]{3,32}$/.test(sel.q)) match.push(sql`o.promo_code = ${sel.q.toUpperCase()}`);
    const byCode = await orderIdsByShortCodeTx(tx, eventId, sel.q);
    if (byCode.length)
      match.push(
        sql`o.id in (${sql.join(
          byCode.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
    where.push(sql`(${sql.join(match, sql` or `)})`);
  }
  return sql.join(where, sql` and `);
}

const COLUMNS = sql`o.id, o.status, o.buyer_name, o.buyer_email, o.currency, o.total_minor, o.promo_code,
  o.collected_by, o.payment_method, o.created_at, o.paid_at,
  coalesce((select sum(i.quantity) from orders.order_items i where i.order_id = o.id), 0)::int as tickets`;

const SOLD_SET = new Set<string>(SOLD_STATUSES);
function toBooking(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    status: r.status as BookingDto['status'],
    buyerName: String(r.buyer_name),
    buyerEmail: String(r.buyer_email),
    currency: String(r.currency),
    totalMinor: Number(r.total_minor),
    tickets: Number(r.tickets),
    comp: SOLD_SET.has(String(r.status)) && Number(r.total_minor) === 0,
    promoCode: (r.promo_code as string | null) ?? null,
    collectedBy: r.collected_by === 'organizer' ? ('organizer' as const) : ('platform' as const),
    paymentMethod: (r.payment_method as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    paidAt: r.paid_at ? new Date(r.paid_at as string) : null,
  };
}
export type BookingRow = ReturnType<typeof toBooking>;

/** The ids a selection matches, newest first, at most `limit` (bulk exports snapshot these). */
export async function bookingIdsTx(
  tx: TenantTx,
  eventId: string,
  sel: BookingSelection,
  limit: number,
): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select o.id from orders.orders o where ${await whereTx(tx, eventId, sel)}
    order by o.created_at desc, o.id desc limit ${limit}`);
  return rows.map((r) => String(r.id));
}

/** Bookings by id (an export chunk), in the order given; unknown ids are skipped. */
export async function bookingRowsTx(tx: TenantTx, ids: readonly string[]): Promise<BookingRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx.execute<Record<string, unknown>>(sql`
    select ${COLUMNS} from orders.orders o
    where o.id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  const byId = new Map(rows.map((r) => [String(r.id), toBooking(r)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Booking search for one event (M1.12): buyer name or email, an order reference (id prefix), a
 * promo code, or a ticket's printed code, with a status filter. Newest first; `total` is the
 * number of matches (the page shows at most `limit`).
 */
export const bookingSearchQuery = tenantQuery({
  name: 'orders.bookingSearch',
  input: BookingSelection.extend({
    eventId: z.uuid(),
    limit: z.int().min(1).max(200).default(50),
  }),
  output: z.object({ total: z.int(), items: z.array(BookingDto) }),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const cond = await whereTx(tx, input.eventId, input);
    const [count] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from orders.orders o where ${cond}`,
    );
    const rows = await tx.execute<Record<string, unknown>>(sql`
      select ${COLUMNS} from orders.orders o where ${cond}
      order by o.created_at desc, o.id desc
      limit ${input.limit}`);
    return { total: Number(count?.n ?? 0), items: rows.map(toBooking) };
  },
});
