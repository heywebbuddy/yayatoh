import { type MigratorSql, migratorSql } from '@yayatoh/db/migration';
import { ensureControlSchema, ident, stagingSchema } from './sql.ts';
import type { Instance } from './transforms/context.ts';

/**
 * Reverse ETL (M2.5a; roadmap §7.5 "Rollback before the point of no return"): after a cutover, the
 * new platform's writes to one instance's events are copied back into that instance's legacy shape
 * (the staging schema `legacy_{inst}`, the same tables the ELT reads), so the route can flip back to
 * the legacy app without losing a sale, a refund or a check-in. It is the inverse of T4/T5:
 *
 * - **Orders** created on the new platform after `cutoverAt` for an event the legacy app knows
 *   (legacy.ref `events`), paid (paid, partially or fully refunded): one legacy `transactions` row
 *   (paid ones), one `bookings` row per ticket (quantity 1, its money from the order item to the
 *   cent, `order_number` = the ticket's short code, typed at the legacy door), one `attendees` row
 *   per ticket, one `commissions` row per paid booking, and a legacy `users` row for a buyer the
 *   legacy app never had (no usable password: they reset it). Orders on events or ticket types
 *   created after the cutover have no legacy home and are listed, not written.
 * - **Refunds** that succeeded after the cutover: their tickets' bookings get `booking_cancel = 3`
 *   (new bookings and migrated one-ticket bookings). An amount-only refund, or one ticket of a
 *   migrated multi-ticket booking, cannot be expressed in the legacy shape and is listed.
 * - **Check-ins** (live admissions after the cutover): a legacy `checkins` row (the inverse of
 *   `legacy.checkin_instant`: the regional date and the UTC time of day) and `checked_in = 1`. An
 *   admission undone since a previous run is removed again.
 *
 * Legacy ids start at 10,000,000 (roadmap: `compat_id ≥ 10M`) and are kept in `legacy.reverse_ref`,
 * so a rerun changes nothing and duplicates nothing; every change to a migrated row is logged in
 * `legacy.reverse_updates`. The result is a reconciliation report (counts and money per currency,
 * new platform vs legacy shape, to the cent) and, on request, the MySQL statements that apply the
 * same rows to the legacy database (`rollbackSql`). Runs as `migrator`; never touches MySQL itself.
 */
export interface ReverseOptions {
  readonly instance: Instance;
  /** The route flip (T−0 go-live): new-platform writes from this instant are copied back. */
  readonly cutoverAt: Date;
  /** Compute and reconcile everything, then roll it back: nothing is written (the default in the CLI). */
  readonly dryRun?: boolean;
  readonly log?: (message: string) => void;
}

export interface ReverseCheck {
  readonly id: string;
  readonly title: string;
  readonly pass: boolean;
  readonly details?: Record<string, unknown>;
}

export interface ReverseReport {
  readonly instance: Instance;
  readonly runId: number;
  readonly cutoverAt: string;
  readonly dryRun: boolean;
  readonly pass: boolean;
  readonly counts: {
    readonly orders: { readonly eligible: number; readonly written: number };
    readonly skipped: Record<string, number>;
    readonly bookings: number;
    readonly attendees: number;
    readonly transactions: number;
    readonly commissions: number;
    readonly users: number;
    readonly refunds: { readonly applied: number; readonly listed: Record<string, number> };
    readonly checkins: { readonly written: number; readonly removed: number };
  };
  readonly money: Record<
    string,
    {
      readonly newTotalMinor: number;
      readonly legacyPaidMinor: number;
      readonly newTicketsMinor: number;
      readonly legacyBookingsMinor: number;
      readonly newRefundedTicketsMinor: number;
      readonly legacyCancelledMinor: number;
    }
  >;
  readonly checks: readonly ReverseCheck[];
  readonly timingsMs: Record<string, number>;
  readonly totalMs: number;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const FIRST_ID = 10_000_000;

async function stagingReady(sql: MigratorSql, instance: Instance): Promise<void> {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.tables
    where table_schema = ${stagingSchema(instance)}
      and table_name in ('users', 'events', 'tickets', 'bookings', 'transactions', 'attendees', 'commissions', 'checkins')`;
  if ((r?.n ?? 0) < 8)
    throw new Error(
      `reverse ETL: the staging schema ${stagingSchema(instance)} is not loaded (run the ELT first)`,
    );
}

/** Allocate legacy ids ≥ 10M for `entity` rows of a temp table `src(new_id text, ord …)`. */
function allocate(entity: string, table: string, staging: string) {
  return `
    insert into legacy.reverse_ref (instance, entity, new_id, legacy_id, run_id)
    select {inst}, ${lit(entity)}, s.new_id,
           greatest(${FIRST_ID - 1},
                    coalesce((select max(legacy_id) from legacy.reverse_ref where instance = {inst} and entity = ${lit(entity)}), 0),
                    coalesce((select max(id) from {s}.${staging}), 0))
             + row_number() over (order by s.ord, s.new_id),
           {run}
    from ${table} s
    where not exists (select 1 from legacy.reverse_ref r where r.instance = {inst} and r.entity = ${lit(entity)} and r.new_id = s.new_id)
    on conflict do nothing;`;
}

export async function reverseEtl(opts: ReverseOptions): Promise<ReverseReport> {
  const log = opts.log ?? ((m: string) => console.info(`reverse-etl ${m}`));
  const sql = migratorSql();
  await ensureControlSchema(sql);
  await stagingReady(sql, opts.instance);
  const [settings] = await sql<{ platform_tz: string }[]>`
    select platform_tz from legacy.instance_settings where instance = ${opts.instance}`;
  if (!settings) throw new Error(`reverse ETL: no migration run for instance ${opts.instance}`);
  const started = Date.now();
  const timings: Record<string, number> = {};
  const [run] = await sql<{ id: string }[]>`
    insert into legacy.reverse_runs (instance, cutover_at) values (${opts.instance}, ${opts.cutoverAt.toISOString()})
    returning id`;
  const runId = Number(run?.id);
  const x = (text: string) =>
    text
      .replaceAll('{s}', ident(stagingSchema(opts.instance)))
      .replaceAll('{inst}', lit(opts.instance))
      .replaceAll('{run}', String(runId))
      .replaceAll('{tz}', lit(settings.platform_tz))
      .replaceAll('{cutover}', `${lit(opts.cutoverAt.toISOString())}::timestamptz`);
  const conn = await sql.reserve();
  const step = async (name: string, text: string) => {
    const t = Date.now();
    await conn.unsafe(x(text));
    timings[name] = Date.now() - t;
    log(`${name} (${timings[name]} ms)`);
  };
  try {
    await conn.unsafe('begin');
    await step(
      'orders',
      `
      drop table if exists r_orders;
      create temp table r_orders as
      select o.id, o.org_id, o.event_id, o.status, o.buyer_email, o.buyer_name, o.buyer_user_id, o.currency,
             o.total_minor, o.fee_minor, o.discount_minor, o.promo_code, o.funds_flow, o.provider, o.provider_payment_id,
             o.created_at, o.updated_at, er.legacy_id::bigint as legacy_event_id,
             case when o.status not in ('paid', 'partially_refunded', 'refunded') then 'status_' || o.status
                  when exists (select 1 from ticketing.tickets k
                               where k.order_id = o.id and not exists (
                                 select 1 from legacy.ref tr where tr.instance = {inst} and tr.entity = 'tickets' and tr.new_id = k.ticket_type_id))
                    then 'ticket_type_not_in_legacy'
             end as skip
      from orders.orders o
      join legacy.ref er on er.instance = {inst} and er.entity = 'events' and er.new_id = o.event_id
      where o.created_at >= {cutover}
        and not exists (select 1 from legacy.ref r where r.instance = {inst} and r.entity = 'orders' and r.new_id = o.id);
      create index on r_orders (id);

      -- Orders on events the legacy app never had (created after the cutover): listed, not written.
      drop table if exists r_orphans;
      create temp table r_orphans as
      select o.id from orders.orders o
      join events.events e on e.id = o.event_id
      where o.created_at >= {cutover} and o.status in ('paid', 'partially_refunded', 'refunded')
        and not exists (select 1 from legacy.ref r where r.new_id = o.event_id and r.entity = 'events')
        and exists (select 1 from legacy.ref r where r.instance = {inst} and r.org_id = o.org_id);

      drop table if exists r_units;
      create temp table r_units as
      select k.id as ticket_id, k.order_id, k.status as ticket_status, k.void_reason, k.short_code, k.holder_name, k.holder_email,
             k.created_at, o.org_id, o.legacy_event_id, tr.legacy_id::bigint as legacy_ticket_id,
             i.unit_face_minor as face, i.unit_discount_minor as disc, i.unit_all_in_minor as allin,
             i.unit_organizer_net_minor as onet, o.currency,
             row_number() over (order by k.created_at, k.id) as ord
      from r_orders o
      join ticketing.tickets k on k.order_id = o.id
      join orders.order_items i on i.id = k.order_item_id
      join legacy.ref tr on tr.instance = {inst} and tr.entity = 'tickets' and tr.new_id = k.ticket_type_id
      where o.skip is null;
      create index on r_units (ticket_id);
    `,
    );

    await step(
      'users',
      `
      -- The legacy customer: the migrated user, else a legacy user with the buyer's email, else a new one.
      drop table if exists r_buyers;
      create temp table r_buyers as
      select o.id as order_id, o.buyer_email, o.buyer_name, o.created_at,
             coalesce(
               (select r.legacy_id::bigint from legacy.ref r where r.instance = {inst} and r.entity = 'users' and r.new_id = o.buyer_user_id),
               (select min(u.id) from {s}.users u where legacy.email_norm(u.email) = legacy.email_norm(o.buyer_email))
             ) as legacy_user_id
      from r_orders o where o.skip is null;

      drop table if exists r_new_users;
      create temp table r_new_users as
      select distinct on (legacy.email_norm(buyer_email)) legacy.email_norm(buyer_email) as new_id, buyer_email, buyer_name,
             created_at, extract(epoch from created_at) as ord
      from r_buyers where legacy_user_id is null
      order by legacy.email_norm(buyer_email), created_at;
      ${allocate('users', 'r_new_users', 'users')}
      insert into {s}.users (id, name, email, password, role_id, status, created_at, updated_at, email_verified_at)
      select r.legacy_id, left(coalesce(nullif(btrim(n.buyer_name), ''), 'Guest'), 255), n.buyer_email,
             -- No usable password: the person resets it on the legacy site.
             '!rollback-no-password', 2, 1,
             (n.created_at at time zone {tz}), (n.created_at at time zone {tz}), (n.created_at at time zone {tz})
      from r_new_users n
      join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'users' and r.new_id = n.new_id
      where not exists (select 1 from {s}.users t where t.id = r.legacy_id);
      update r_buyers b set legacy_user_id = r.legacy_id
      from legacy.reverse_ref r
      where b.legacy_user_id is null and r.instance = {inst} and r.entity = 'users' and r.new_id = legacy.email_norm(b.buyer_email);
    `,
    );

    await step(
      'transactions',
      `
      drop table if exists r_paid;
      create temp table r_paid as
      select id::text as new_id, extract(epoch from created_at) as ord, * from r_orders
      where skip is null and total_minor > 0 and provider_payment_id is not null;
      ${allocate('transactions', 'r_paid', 'transactions')}
      insert into {s}.transactions (id, amount_paid, item_sku, order_number, txn_id, payer_reference, currency_code,
                                    payment_status, payment_gateway, status, created_at, updated_at)
      select r.legacy_id, round(p.total_minor / 100.0, 2), 0, 'yy2-' || p.id, p.provider_payment_id, null, p.currency,
             'Payment complete.', case when p.funds_flow = 'organizer_mor' then 'Stripe Direct' else 'Stripe' end, 1,
             (p.created_at at time zone {tz}), (p.updated_at at time zone {tz})
      from r_paid p
      join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'transactions' and r.new_id = p.new_id
      where not exists (select 1 from {s}.transactions t where t.id = r.legacy_id);
    `,
    );

    await step(
      'bookings',
      `
      drop table if exists r_book;
      create temp table r_book as select ticket_id::text as new_id, * from r_units;
      ${allocate('bookings', 'r_book', 'bookings')}
      insert into {s}.bookings (id, customer_id, organiser_id, event_id, ticket_id, quantity, price, tax, net_price, status,
                                created_at, updated_at, event_title, event_start_date, event_end_date, event_start_time,
                                event_end_time, event_repetitive, ticket_title, ticket_price, event_category, booking_cancel,
                                order_number, transaction_id, customer_name, customer_email, currency, checked_in, payment_type,
                                is_paid, is_bulk, is_distributable, promocode, promocode_reward, common_order)
      select r.legacy_id, b.legacy_user_id, ev.user_id, u.legacy_event_id, u.legacy_ticket_id, 1,
             round(u.face / 100.0, 2), 0, round(u.allin / 100.0, 2), 1,
             (u.created_at at time zone {tz}), (u.created_at at time zone {tz}),
             coalesce(ev.title, ''), ev.start_date, ev.end_date, ev.start_time, ev.end_time, coalesce(ev.repetitive, 0),
             coalesce(t.title, ''), coalesce(t.price, round(u.face / 100.0, 2)),
             coalesce((select c.name from {s}.categories c where c.id = ev.category_id), ''),
             case when u.ticket_status = 'void' then 2 else 0 end,
             u.short_code, coalesce(tx.legacy_id, 0), left(coalesce(nullif(btrim(o.buyer_name), ''), 'Guest'), 256),
             o.buyer_email, u.currency, 0,
             case when tx.legacy_id is not null then 'online' else 'offline' end,
             1, 0, 0, o.promo_code, to_char(u.disc / 100.0, 'FM999999990.00'), 'yy2-' || o.id
      from r_units u
      join r_orders o on o.id = u.order_id
      join r_buyers b on b.order_id = o.id
      join {s}.events ev on ev.id = u.legacy_event_id
      left join {s}.tickets t on t.id = u.legacy_ticket_id
      left join legacy.reverse_ref tx on tx.instance = {inst} and tx.entity = 'transactions' and tx.new_id = o.id::text
      join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'bookings' and r.new_id = u.ticket_id::text
      where not exists (select 1 from {s}.bookings t where t.id = r.legacy_id);
      -- A ticket voided since a previous run (cancelled): its booking follows (refunds below win).
      update {s}.bookings bk set booking_cancel = 2
      from r_units u join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'bookings' and r.new_id = u.ticket_id::text
      where bk.id = r.legacy_id and u.ticket_status = 'void' and bk.booking_cancel = 0;
    `,
    );

    await step(
      'attendees',
      `
      ${allocate('attendees', 'r_book', 'attendees')}
      insert into {s}.attendees (id, user_id, ticket_id, event_id, booking_id, name, address, status, assignment_status,
                                 checked_in, created_at, updated_at, common_order)
      select a.legacy_id, null, u.legacy_ticket_id, u.legacy_event_id, bk.legacy_id,
             left(coalesce(nullif(btrim(u.holder_name), ''), 'Guest'), 255), u.holder_email, 1, 'assigned', 0,
             (u.created_at at time zone {tz}), (u.created_at at time zone {tz}), 'yy2-' || u.order_id
      from r_units u
      join legacy.reverse_ref a on a.instance = {inst} and a.entity = 'attendees' and a.new_id = u.ticket_id::text
      join legacy.reverse_ref bk on bk.instance = {inst} and bk.entity = 'bookings' and bk.new_id = u.ticket_id::text
      where not exists (select 1 from {s}.attendees t where t.id = a.legacy_id);
    `,
    );

    await step(
      'commissions',
      `
      drop table if exists r_comm;
      create temp table r_comm as select * from r_book where allin > 0;
      ${allocate('commissions', 'r_comm', 'commissions')}
      insert into {s}.commissions (id, organiser_id, booking_id, admin_commission, customer_paid, organiser_earning, transferred,
                                   month_year, status, created_at, updated_at, event_id, admin_tax, settled)
      select c.legacy_id, ev.user_id, bk.legacy_id, round((u.allin - u.onet) / 100.0, 2), round(u.allin / 100.0, 2),
             round(u.onet / 100.0, 2), 0, to_char(u.created_at at time zone {tz}, 'MM YYYY'),
             case when u.ticket_status = 'active' then 1 else 0 end,
             (u.created_at at time zone {tz}), (u.created_at at time zone {tz}), u.legacy_event_id, 0, 0
      from r_comm u
      join {s}.events ev on ev.id = u.legacy_event_id
      join legacy.reverse_ref c on c.instance = {inst} and c.entity = 'commissions' and c.new_id = u.ticket_id::text
      join legacy.reverse_ref bk on bk.instance = {inst} and bk.entity = 'bookings' and bk.new_id = u.ticket_id::text
      where not exists (select 1 from {s}.commissions t where t.id = c.legacy_id);
    `,
    );

    await step(
      'refunds',
      `
      -- The legacy booking of each ticket: a reverse booking, a migrated hand-on row, or the migrated
      -- booking of its unit (with that booking's quantity).
      drop table if exists r_ticket_booking;
      create temp table r_ticket_booking as
      select r.new_id::uuid as ticket_id, r.legacy_id as booking_id, 1::bigint as qty, 'reverse' as origin
      from legacy.reverse_ref r where r.instance = {inst} and r.entity = 'bookings'
      union all
      select distinct on (u.new_id) u.new_id, split_part(u.legacy_id, ':', 1)::bigint, b.quantity, 'migrated'
      from legacy.ref u join {s}.bookings b on b.id = split_part(u.legacy_id, ':', 1)::bigint
      where u.instance = {inst} and u.entity = 'booking_units'
        and not exists (select 1 from legacy.ref h join {s}.bookings hb on hb.id::text = h.legacy_id and hb.distributed_from_booking_id is not null
                        where h.instance = {inst} and h.entity = 'bookings' and h.new_id = u.new_id)
      union all
      select h.new_id, h.legacy_id::bigint, 1, 'migrated'
      from legacy.ref h join {s}.bookings hb on hb.id::text = h.legacy_id and hb.distributed_from_booking_id is not null
      where h.instance = {inst} and h.entity = 'bookings';
      create index on r_ticket_booking (ticket_id);

      drop table if exists r_refunds;
      create temp table r_refunds as
      select f.id, f.order_id, f.amount_minor, f.currency, f.ticket_ids, f.completed_at
      from orders.refunds f
      join orders.orders o on o.id = f.order_id
      join legacy.ref er on er.instance = {inst} and er.entity = 'events' and er.new_id = o.event_id
      where f.status = 'succeeded' and coalesce(f.completed_at, f.created_at) >= {cutover};

      drop table if exists r_refund_tickets;
      create temp table r_refund_tickets as
      select f.id as refund_id, t.ticket_id, tb.booking_id, tb.qty, tb.origin
      from r_refunds f cross join lateral unnest(f.ticket_ids) as t(ticket_id)
      left join r_ticket_booking tb on tb.ticket_id = t.ticket_id;

      insert into legacy.reverse_updates (instance, source, new_id, legacy_table, legacy_id, change, run_id)
      select {inst}, 'refund', rt.refund_id::text || ':' || rt.ticket_id, 'bookings', rt.booking_id,
             jsonb_build_object('booking_cancel', 3, 'was', b.booking_cancel), {run}
      from r_refund_tickets rt join {s}.bookings b on b.id = rt.booking_id
      where rt.booking_id is not null and rt.qty = 1
      on conflict do nothing;
      update {s}.bookings b set booking_cancel = 3, updated_at = (f.completed_at at time zone {tz})
      from r_refund_tickets rt join r_refunds f on f.id = rt.refund_id
      where b.id = rt.booking_id and rt.qty = 1 and b.booking_cancel <> 3;
      update {s}.commissions c set status = 0
      from r_refund_tickets rt where c.booking_id = rt.booking_id and rt.qty = 1 and c.status <> 0;
    `,
    );

    await step(
      'checkins',
      `
      drop table if exists r_adm;
      create temp table r_adm as
      select a.id::text as new_id, extract(epoch from a.admitted_at) as ord, a.id, a.ticket_id, a.admitted_at, a.admitted_by,
             tb.booking_id, tb.origin, b.event_id as legacy_event_id
      from checkin.admissions a
      join events.events e on e.id = a.event_id
      join legacy.ref er on er.instance = {inst} and er.entity = 'events' and er.new_id = a.event_id
      join r_ticket_booking tb on tb.ticket_id = a.ticket_id
      join {s}.bookings b on b.id = tb.booking_id
      where a.admitted_at >= {cutover} and a.undone_at is null
        -- T5's own imports (legacy check-ins) are not new: their scans carry a legacy: client id.
        and not exists (select 1 from checkin.scans s where s.admission_id = a.id and s.client_scan_id like 'legacy:%');
      ${allocate('checkins', 'r_adm', 'checkins')}
      insert into {s}.checkins (id, booking_id, event_id, event_start_date, check_in_time, kids_count, user_id, created_at, updated_at)
      select r.legacy_id, a.booking_id, a.legacy_event_id, (a.admitted_at at time zone {tz})::date,
             (date_trunc('second', a.admitted_at) at time zone 'UTC')::time, 0,
             (select u.legacy_id::bigint from legacy.ref u where u.instance = {inst} and u.entity = 'users' and u.new_id = a.admitted_by),
             (a.admitted_at at time zone {tz}), (a.admitted_at at time zone {tz})
      from r_adm a
      join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'checkins' and r.new_id = a.new_id
      where not exists (select 1 from {s}.checkins t where t.id = r.legacy_id);
      insert into legacy.reverse_updates (instance, source, new_id, legacy_table, legacy_id, change, run_id)
      select {inst}, 'checkin', a.new_id, 'bookings', a.booking_id, jsonb_build_object('checked_in', 1), {run}
      from r_adm a where a.origin = 'migrated'
      on conflict do nothing;
      update {s}.bookings b set checked_in = 1, checked_in_time = (a.admitted_at at time zone {tz})
      from r_adm a where b.id = a.booking_id and b.checked_in = 0;
      update {s}.attendees t set checked_in = 1
      from r_adm a where t.booking_id = a.booking_id and a.origin = 'reverse' and t.checked_in = 0;

      -- An admission undone since the previous run: its legacy check-in goes again.
      drop table if exists r_undone;
      create temp table r_undone as
      select r.legacy_id from legacy.reverse_ref r
      where r.instance = {inst} and r.entity = 'checkins'
        and not exists (select 1 from r_adm a where a.new_id = r.new_id);
      delete from {s}.checkins c using r_undone u where c.id = u.legacy_id;
    `,
    );
    const t = Date.now();
    const report = await reconcile(conn as unknown as MigratorSql, x, opts, runId);
    timings.reconcile = Date.now() - t;
    // A dry run computes and reconciles everything, then writes nothing.
    await conn.unsafe(opts.dryRun ? 'rollback' : 'commit');
    await conn.unsafe('discard temp').catch(() => {});
    conn.release();
    const full: ReverseReport = { ...report, timingsMs: timings, totalMs: Date.now() - started };
    const status = opts.dryRun ? 'dry_run' : full.pass ? 'succeeded' : 'failed';
    await sql`update legacy.reverse_runs set status = ${status}, finished_at = now(),
                report = ${JSON.stringify(full)}::text::jsonb where id = ${runId}`;
    return full;
  } catch (err) {
    await conn.unsafe('rollback').catch(() => {});
    conn.release();
    await sql`update legacy.reverse_runs set status = 'failed', finished_at = now(), report = ${JSON.stringify({ error: String(err) })}::text::jsonb where id = ${runId}`.catch(
      () => {},
    );
    throw err;
  }
}

async function reconcile(
  sql: MigratorSql,
  x: (text: string) => string,
  opts: ReverseOptions,
  runId: number,
): Promise<Omit<ReverseReport, 'timingsMs' | 'totalMs'>> {
  const one = async <T>(text: string): Promise<T> => ((await sql.unsafe(x(text))) as unknown as T[])[0] as T;
  const all = async <T>(text: string): Promise<T[]> => (await sql.unsafe(x(text))) as unknown as T[];
  const counts = await one<{
    eligible: number;
    written: number;
    bookings: number;
    attendees: number;
    transactions: number;
    commissions: number;
    users: number;
    checkins: number;
    removed: number;
    units: number;
    paid: number;
  }>(`
    select (select count(*) from r_orders)::int as eligible,
           (select count(*) from r_orders where skip is null)::int as written,
           (select count(*) from r_units u join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'bookings' and r.new_id = u.ticket_id::text)::int as bookings,
           (select count(*) from r_units u join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'attendees' and r.new_id = u.ticket_id::text)::int as attendees,
           (select count(*) from r_paid p join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'transactions' and r.new_id = p.new_id)::int as transactions,
           (select count(*) from r_comm c join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'commissions' and r.new_id = c.new_id)::int as commissions,
           (select count(distinct r.legacy_id) from r_buyers b join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'users' and r.new_id = legacy.email_norm(b.buyer_email))::int as users,
           (select count(*) from r_adm a join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'checkins' and r.new_id = a.new_id)::int as checkins,
           (select count(*) from r_undone)::int as removed,
           (select count(*) from r_units)::int as units,
           (select count(*) from r_paid)::int as paid`);
  const skipped: Record<string, number> = {};
  for (const r of await all<{ skip: string; n: number }>(
    `select skip, count(*)::int as n from r_orders where skip is not null group by 1
     union all select 'event_not_in_legacy', count(*)::int from r_orphans having count(*) > 0`,
  ))
    skipped[r.skip] = r.n;
  const refundRows = await one<{
    applied: number;
    amount_only: number;
    unit_of_multi: number;
    unknown_ticket: number;
  }>(`
    select (select count(*) from r_refund_tickets where booking_id is not null and qty = 1)::int as applied,
           (select count(*) from r_refunds where cardinality(ticket_ids) = 0)::int as amount_only,
           (select count(*) from r_refund_tickets where booking_id is not null and qty > 1)::int as unit_of_multi,
           (select count(*) from r_refund_tickets where booking_id is null)::int as unknown_ticket`);
  const listed: Record<string, number> = {};
  if (refundRows.amount_only) listed.refund_amount_only = refundRows.amount_only;
  if (refundRows.unit_of_multi) listed.refund_unit_of_multi_ticket_booking = refundRows.unit_of_multi;
  if (refundRows.unknown_ticket) listed.refund_ticket_not_in_legacy = refundRows.unknown_ticket;

  // Money per currency: the new platform's orders and tickets vs what the legacy shape now holds.
  const money: ReverseReport['money'] = {};
  for (const m of await all<{
    currency: string;
    new_total: string;
    legacy_paid: string;
    new_tickets: string;
    legacy_bookings: string;
    new_refunded: string;
    legacy_cancelled: string;
  }>(`
    with cur as (select distinct currency from r_orders where skip is null)
    select cur.currency,
      coalesce((select sum(total_minor) from r_paid p where p.currency = cur.currency), 0) as new_total,
      coalesce((select sum(round(t.amount_paid * 100)) from {s}.transactions t
                join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'transactions' and r.legacy_id = t.id
                join r_paid p on p.id::text = r.new_id where t.currency_code = cur.currency), 0) as legacy_paid,
      coalesce((select sum(allin) from r_units u where u.currency = cur.currency), 0) as new_tickets,
      coalesce((select sum(round(b.net_price * 100)) from {s}.bookings b
                join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'bookings' and r.legacy_id = b.id
                join r_units u on u.ticket_id::text = r.new_id
                where b.currency = cur.currency), 0) as legacy_bookings,
      coalesce((select sum(u.allin) from r_units u where u.currency = cur.currency
                and exists (select 1 from r_refund_tickets rt where rt.ticket_id = u.ticket_id)), 0) as new_refunded,
      coalesce((select sum(round(b.net_price * 100)) from {s}.bookings b
                join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'bookings' and r.legacy_id = b.id
                join r_units u on u.ticket_id::text = r.new_id
                join r_refund_tickets rt on rt.ticket_id = u.ticket_id
                where b.currency = cur.currency and b.booking_cancel = 3), 0) as legacy_cancelled
    from cur order by 1`))
    money[m.currency] = {
      newTotalMinor: Number(m.new_total),
      legacyPaidMinor: Number(m.legacy_paid),
      newTicketsMinor: Number(m.new_tickets),
      legacyBookingsMinor: Number(m.legacy_bookings),
      newRefundedTicketsMinor: Number(m.new_refunded),
      legacyCancelledMinor: Number(m.legacy_cancelled),
    };
  const dup = await one<{ n: number }>(`
    select (select count(*) from (select order_number from {s}.bookings b
              join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'bookings' and r.legacy_id = b.id
              group by order_number having count(*) > 1) d)::int
         + (select count(*) from (select booking_id, event_start_date from {s}.checkins c
              join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'checkins' and r.legacy_id = c.id
              group by 1, 2 having count(*) > 1) d)::int as n`);
  const liveAdm = await one<{ n: number; round_trip_bad: number }>(`
    select count(*)::int as n,
           count(*) filter (where abs(extract(epoch from (legacy.checkin_instant(c.event_start_date, c.check_in_time, {tz}) - date_trunc('second', a.admitted_at)))) > 0)::int as round_trip_bad
    from r_adm a
    join legacy.reverse_ref r on r.instance = {inst} and r.entity = 'checkins' and r.new_id = a.new_id
    join {s}.checkins c on c.id = r.legacy_id`);
  const moneyOk = Object.values(money).every(
    (m) =>
      m.newTotalMinor === m.legacyPaidMinor &&
      m.newTicketsMinor === m.legacyBookingsMinor &&
      m.newRefundedTicketsMinor === m.legacyCancelledMinor,
  );
  const checks: ReverseCheck[] = [
    {
      id: 'R1',
      title: 'Every paid post-cutover order on a legacy event is in the legacy shape (others listed)',
      pass: counts.written + Object.values(skipped).reduce((a, b) => a + b, 0) >= counts.eligible,
      details: { eligible: counts.eligible, written: counts.written, skipped },
    },
    {
      id: 'R2',
      title: 'One booking and one attendee per ticket; one transaction per paid order',
      pass:
        counts.bookings >= counts.units &&
        counts.attendees >= counts.units &&
        counts.transactions >= counts.paid,
      details: {
        tickets: counts.units,
        bookings: counts.bookings,
        attendees: counts.attendees,
        paid: counts.paid,
      },
    },
    {
      id: 'R3',
      title: 'Money per currency to the cent (orders, tickets, refunded tickets)',
      pass: moneyOk,
      details: money,
    },
    {
      id: 'R4',
      title: 'Check-ins: one legacy row per live admission, instant round-trips to the second',
      pass: liveAdm.round_trip_bad === 0,
      details: { admissions: liveAdm.n, badRoundTrip: liveAdm.round_trip_bad, removed: counts.removed },
    },
    {
      id: 'R5',
      title: 'No duplicates (order numbers, check-ins per booking and day)',
      pass: dup.n === 0,
      details: { duplicates: dup.n },
    },
  ];
  return {
    instance: opts.instance,
    runId,
    cutoverAt: opts.cutoverAt.toISOString(),
    dryRun: opts.dryRun === true,
    pass: checks.every((c) => c.pass),
    counts: {
      orders: { eligible: counts.eligible, written: counts.written },
      skipped,
      bookings: counts.bookings,
      attendees: counts.attendees,
      transactions: counts.transactions,
      commissions: counts.commissions,
      users: counts.users,
      refunds: { applied: refundRows.applied, listed },
      checkins: { written: counts.checkins, removed: counts.removed },
    },
    money,
    checks,
  };
}

export function summarizeReverse(r: ReverseReport): string {
  const lines = [
    `reverse ETL${r.dryRun ? ' (dry run: nothing written)' : ''} — instance ${r.instance}, run ${r.runId} (cutover ${r.cutoverAt}): ${r.pass ? 'PASS' : 'FAIL'}`,
    ...r.checks.map((c) => `  ${c.pass ? 'ok  ' : 'FAIL'} ${c.id} ${c.title}`),
    `  orders ${r.counts.orders.written}/${r.counts.orders.eligible} written; bookings ${r.counts.bookings}, attendees ${r.counts.attendees}, transactions ${r.counts.transactions}, commissions ${r.counts.commissions}, new legacy users ${r.counts.users}`,
    `  refunds applied ${r.counts.refunds.applied}; check-ins ${r.counts.checkins.written} (removed ${r.counts.checkins.removed})`,
  ];
  const skipped = Object.entries(r.counts.skipped);
  if (skipped.length)
    lines.push(`  listed for owner review: ${skipped.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const refunds = Object.entries(r.counts.refunds.listed);
  if (refunds.length) lines.push(`  refunds listed: ${refunds.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`  time: ${r.totalMs} ms`);
  return lines.join('\n');
}

const MYSQL_TABLES = ['users', 'transactions', 'bookings', 'attendees', 'commissions', 'checkins'] as const;

function mysqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
  const s = String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0');
  return `'${s}'`;
}

/**
 * The MySQL statements that apply the reverse ETL to the legacy database (the owner runs them in
 * the rollback, after a review): an idempotent `INSERT … ON DUPLICATE KEY UPDATE` per reverse row
 * (ids ≥ 10M) and an `UPDATE` per change to a migrated booking. Nothing is executed here.
 */
export async function rollbackSql(instance: Instance): Promise<string> {
  const sql = migratorSql();
  await ensureControlSchema(sql);
  const S = ident(stagingSchema(instance));
  const out: string[] = [
    `-- Yayatoh reverse ETL for ${instance} (M2.5a). Review, then apply to the legacy MySQL database in the rollback.`,
    'SET NAMES utf8mb4;',
    'START TRANSACTION;',
  ];
  for (const table of MYSQL_TABLES) {
    const rows = (await sql.unsafe(
      `select t.* from ${S}.${ident(table)} t
       join legacy.reverse_ref r on r.instance = $1 and r.entity = $2 and r.legacy_id = t.id
       order by t.id`,
      [instance, table],
    )) as unknown as Record<string, unknown>[];
    for (const row of rows) {
      const cols = Object.keys(row);
      out.push(
        `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map((c) => mysqlValue(row[c])).join(', ')}) ON DUPLICATE KEY UPDATE ${cols
          .filter((c) => c !== 'id')
          .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
          .join(', ')};`,
      );
    }
  }
  const updates = await sql<{ legacy_id: string; change: Record<string, number> }[]>`
    select legacy_id, change from legacy.reverse_updates
    where instance = ${instance} and legacy_table = 'bookings' order by legacy_id, source, new_id`;
  for (const u of updates) {
    const sets = Object.entries(u.change)
      .filter(([k]) => k === 'booking_cancel' || k === 'checked_in')
      .map(([k, v]) => `\`${k}\` = ${Number(v)}`);
    if (sets.length)
      out.push(`UPDATE \`bookings\` SET ${sets.join(', ')} WHERE \`id\` = ${Number(u.legacy_id)};`);
  }
  out.push('COMMIT;', '');
  return out.join('\n');
}
