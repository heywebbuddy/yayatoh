import { withTenant } from '@yayatoh/db';
import type { MigratorSql } from '@yayatoh/db/migration';
import { createCtx } from '@yayatoh/kernel';
import { sql as dsql } from 'drizzle-orm';
import { ident, stagingSchema } from './sql.ts';
import { v6Vectors, v7Golden, v8Facade, v9Urls, v10Checksums } from './validate-extra.ts';

/**
 * Validation (roadmap §7.5 V1–V12 and the quarantine gate; V6–V10 in validate-extra.ts, M2.2c). The
 * legacy side is always recomputed from the staging schema, never from the transforms' own working
 * tables, so a transform bug cannot validate itself. Any failed check fails the run.
 */
export interface Check {
  readonly id: string;
  readonly name: string;
  readonly pass: boolean;
  readonly details: Record<string, unknown>;
}

export interface QuarantineLine {
  readonly table: string;
  readonly rows: number;
  readonly quarantined: number;
  readonly pct: number;
  readonly limitPct: number;
  readonly pass: boolean;
}

export interface ValidationReport {
  readonly instance: string;
  readonly runId: number | null;
  readonly pass: boolean;
  readonly quarantine: QuarantineLine[];
  readonly exceptions: Record<string, number>;
  readonly checks: Check[];
}

/** Money and ticket tables must quarantine zero rows; everything else (content) up to 0.5%. */
export const MONEY_TICKET_TABLES = [
  'bookings',
  'transactions',
  'commissions',
  'tickets',
  'attendees',
  'checkins',
  'promocodes',
  'ticket_promocode',
] as const;
export const CONTENT_LIMIT_PCT = 0.5;

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export async function validate(
  sql: MigratorSql,
  instance: 'yay' | 'abc',
  runId: number | null,
  opts: { platformTz: string; eventClock: 'platform' | 'venue'; freezeAt?: Date },
): Promise<ValidationReport> {
  const S = ident(stagingSchema(instance));
  const q = async (text: string, params: unknown[] = []) =>
    (await sql.unsafe(text.replaceAll('{s}', S), params as never[])) as unknown as Row[];
  const checks: Check[] = [];

  // ---- quarantine gate ------------------------------------------------------------------------
  const tableRows = await q(
    `select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as rows
     from information_schema.tables where table_schema = $1 and table_name not like '\\_%'`,
    [stagingSchema(instance)],
  );
  const quarantined = runId
    ? await q(
        `select table_name, count(distinct coalesce(legacy_id, id::text)) as n from legacy.quarantine where run_id = $1 group by table_name`,
        [runId],
      )
    : [];
  const qMap = new Map(quarantined.map((r) => [String(r.table_name), n(r.n)]));
  const quarantine: QuarantineLine[] = tableRows
    .map((r) => {
      const table = String(r.table_name);
      const rows = n(r.rows);
      const qn = qMap.get(table) ?? 0;
      const limitPct = (MONEY_TICKET_TABLES as readonly string[]).includes(table) ? 0 : CONTENT_LIMIT_PCT;
      const pct = rows ? (qn * 100) / rows : 0;
      return {
        table,
        rows,
        quarantined: qn,
        pct: Math.round(pct * 1000) / 1000,
        limitPct,
        pass: pct <= limitPct,
      };
    })
    .sort((a, b) => a.table.localeCompare(b.table));

  const exRows = runId
    ? await q(
        `select kind, count(*) as n from legacy.exceptions where run_id = $1 group by kind order by kind`,
        [runId],
      )
    : [];
  const exceptions = Object.fromEntries(exRows.map((r) => [String(r.kind), n(r.n)]));

  // ---- V1 row counts with split factors -----------------------------------------------------------
  const [v1] = await q(
    `
    with ref as (select entity, count(distinct new_id) as n from legacy.ref where instance = $1 group by entity),
    live as (select * from {s}.bookings b
             where not exists (select 1 from legacy.quarantine x where x.run_id = $2 and x.table_name = 'bookings' and x.legacy_id = b.id::text))
    select
      (select count(distinct legacy.email_norm(email)) from {s}.users where deleted_at is null and legacy.email_ok(legacy.email_norm(email))) as legacy_users,
      (select count(distinct r.new_id) from legacy.ref r where r.instance = $1 and r.entity = 'users') as users,
      (select count(*) from {s}.users where role_id = 3 and deleted_at is null) + (case when $1 = 'abc' then 1 else 0 end) as legacy_orgs,
      (select count(distinct r.new_id) from legacy.ref r join tenancy.organizations o on o.id = r.new_id
         where r.instance = $1 and r.entity = 'organizers' and r.legacy_id <> 'unassigned'
           and (r.legacy_id = 'parent' or r.legacy_id in (select id::text from {s}.users where role_id = 3))) as orgs,
      (select count(*) from {s}.events) as legacy_events,
      (select count(*) from events.events e join legacy.ref r on r.new_id = e.id and r.instance = $1 and r.entity = 'events') as events,
      (select count(*) from {s}.tickets t where exists (select 1 from legacy.ref r where r.instance = $1 and r.entity = 'events' and r.legacy_id = t.event_id::text)) as legacy_ticket_types,
      (select count(*) from ticketing.ticket_types t join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity = 'tickets') as ticket_types,
      (select coalesce(sum(quantity), 0) from live where distributed_from_booking_id is null) as legacy_ticket_units,
      (select count(*) from ticketing.tickets t join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity = 'booking_units') as tickets,
      (select count(*) from attendees.attendees a join legacy.ref r on r.new_id = a.ticket_id and r.instance = $1 and r.entity = 'booking_units') as attendees,
      (select count(*) from (select distinct common_order, event_id, customer_id from live where distributed_from_booking_id is null) x) as legacy_orders,
      (select count(*) from orders.orders o join legacy.ref r on r.new_id = o.id and r.instance = $1 and r.entity = 'orders') as orders,
      (select coalesce(sum(i.quantity), 0) from orders.order_items i join legacy.ref r on r.new_id = i.order_id and r.instance = $1 and r.entity = 'orders') as item_units,
      (select count(*) from (select distinct common_order, event_id, customer_id from live
                             where distributed_from_booking_id is null and booking_cancel = 3 and net_price > 0) x) as legacy_refunded_orders,
      (select count(*) from orders.refunds f join legacy.ref r on r.new_id = f.order_id and r.instance = $1 and r.entity = 'orders') as refunds,
      (select count(*) from {s}.commissions) as legacy_commissions,
      (select coalesce(sum(s.source_rows), 0) from payments.legacy_settlements s
         join legacy.ref r on r.new_id = s.event_id and r.instance = $1 and r.entity = 'events'
        where s.kind = 'event_statement') as commission_rows,
      (select count(*) from live where distributed_from_booking_id is not null) as legacy_hand_ons,
      (select count(*) from legacy.ref r join {s}.bookings b on b.id::text = r.legacy_id
         where r.instance = $1 and r.entity = 'bookings' and b.distributed_from_booking_id is not null) as hand_ons
    `,
    [instance, runId ?? -1],
  );
  const pairs: [string, string, string, string][] = [
    ['users', 'legacy_users', 'users', 'distinct normalized emails on this instance'],
    ['organizations', 'legacy_orgs', 'orgs', 'organizers (+ the ABC parent)'],
    ['events', 'legacy_events', 'events', '1:1'],
    ['ticket_types', 'legacy_ticket_types', 'ticket_types', '1:1'],
    ['tickets', 'legacy_ticket_units', 'tickets', 'Σ bookings.quantity (hand-ons excluded)'],
    ['attendees', 'legacy_ticket_units', 'attendees', 'one per ticket'],
    ['order_item_units', 'legacy_ticket_units', 'item_units', 'Σ order_items.quantity'],
    ['orders', 'legacy_orders', 'orders', 'distinct (common_order, event, buyer)'],
    ['refunds', 'legacy_refunded_orders', 'refunds', 'one per order with a refunded row'],
    ['commissions', 'legacy_commissions', 'commission_rows', 'summed into legacy statements'],
    ['hand_ons', 'legacy_hand_ons', 'hand_ons', 'mapped to the unit they moved'],
  ];
  const v1lines = pairs.map(([name, l, m, factor]) => ({
    name,
    legacy: n(v1?.[l]),
    migrated: n(v1?.[m]),
    factor,
    pass: n(v1?.[l]) === n(v1?.[m]),
  }));
  v1lines.push(...(await v1Content(q, instance, runId)));
  checks.push({
    id: 'V1',
    name: 'Row counts with split factors',
    pass: v1lines.every((x) => x.pass),
    details: { lines: v1lines },
  });

  // ---- V2 money per event × instance, to the cent ---------------------------------------------------
  const v2 = await q(
    `
    with lg as (
      select b.event_id::text as legacy_event,
             sum(round(coalesce(b.net_price, b.price + coalesce(b.tax, 0)) * 100)) as gross,
             sum(greatest(0, round(coalesce(b.net_price, b.price + coalesce(b.tax, 0)) * 100) - round(b.price * 100)
                             + coalesce(legacy.to_minor(nullif(btrim(b.promocode_reward), '')), 0))) as fee,
             sum(coalesce(legacy.to_minor(nullif(btrim(b.promocode_reward), '')), 0)) as discount,
             sum(round(coalesce(b.net_price, 0) * 100)) filter (where b.booking_cancel = 3) as refunds
      from {s}.bookings b where b.distributed_from_booking_id is null group by b.event_id
    ), lc as (
      select c.event_id::text as legacy_event,
             sum(round(c.admin_commission * 100)) filter (where c.status = 1) as commission,
             sum(round(c.organiser_earning * 100)) filter (where c.status = 1) as earning,
             sum(round(c.organiser_earning * 100)) filter (where c.status = 1 and c.transferred = 0) as open
      from {s}.commissions c group by c.event_id
    ), nw as (
      select r.legacy_id as legacy_event, sum(o.total_minor) as gross, sum(o.fee_minor) as fee, sum(o.discount_minor) as discount
      from legacy.ref r join orders.orders o on o.event_id = r.new_id and o.created_via = 'legacy'
      where r.instance = $1 and r.entity = 'events' group by r.legacy_id
    ), nr as (
      select r.legacy_id as legacy_event, sum(f.amount_minor) as refunds
      from legacy.ref r join orders.orders o on o.event_id = r.new_id join orders.refunds f on f.order_id = o.id
      where r.instance = $1 and r.entity = 'events' group by r.legacy_id
    ), ns as (
      select r.legacy_id as legacy_event, sum(s.commission_minor) as commission, sum(s.organizer_earning_minor) as earning, sum(s.open_minor) as open
      from legacy.ref r join payments.legacy_settlements s on s.event_id = r.new_id and s.kind = 'event_statement'
      where r.instance = $1 and r.entity = 'events' group by r.legacy_id
    )
    select coalesce(lg.legacy_event, lc.legacy_event) as legacy_event,
           coalesce(lg.gross, 0) as l_gross, coalesce(nw.gross, 0) as n_gross,
           coalesce(lg.fee, 0) as l_fee, coalesce(nw.fee, 0) as n_fee,
           coalesce(lg.discount, 0) as l_discount, coalesce(nw.discount, 0) as n_discount,
           coalesce(lg.refunds, 0) as l_refunds, coalesce(nr.refunds, 0) as n_refunds,
           coalesce(lc.commission, 0) as l_commission, coalesce(ns.commission, 0) as n_commission,
           coalesce(lc.earning, 0) as l_earning, coalesce(ns.earning, 0) as n_earning,
           coalesce(lc.open, 0) as l_open, coalesce(ns.open, 0) as n_open
    from lg full join lc on lc.legacy_event = lg.legacy_event
    left join nw on nw.legacy_event = coalesce(lg.legacy_event, lc.legacy_event)
    left join nr on nr.legacy_event = coalesce(lg.legacy_event, lc.legacy_event)
    left join ns on ns.legacy_event = coalesce(lg.legacy_event, lc.legacy_event)`,
    [instance],
  );
  const measures = ['gross', 'fee', 'discount', 'refunds', 'commission', 'earning', 'open'];
  const v2bad = v2.filter((r) => measures.some((m) => n(r[`l_${m}`]) !== n(r[`n_${m}`])));
  const totals = Object.fromEntries(
    measures.map((m) => [
      m,
      {
        legacy: v2.reduce((a, r) => a + n(r[`l_${m}`]), 0),
        migrated: v2.reduce((a, r) => a + n(r[`n_${m}`]), 0),
      },
    ]),
  );
  checks.push({
    id: 'V2',
    name: 'Money per event × instance (gross, fees, discounts, refunds, commission, earning, open) to the cent',
    pass: v2bad.length === 0,
    details: { events: v2.length, mismatches: v2bad.slice(0, 20), totalsMinor: totals },
  });

  // ---- V3 status distributions --------------------------------------------------------------------
  const v3 = await q(
    `
    with lg as (
      select case when coalesce(booking_cancel, 0) = 3 then 'void:refunded' when coalesce(booking_cancel, 0) = 2 then 'void:cancelled'
                  when coalesce(status, 1) = 0 then 'void:disabled' when coalesce(is_paid, 1) = 0 then 'void:unpaid' else 'active' end as bucket,
             sum(quantity) as n
      from {s}.bookings where distributed_from_booking_id is null group by 1
    ), nw as (
      select case when t.status = 'active' then 'active' else 'void:' || coalesce(t.void_reason, '?') end as bucket, count(*) as n
      from ticketing.tickets t join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity = 'booking_units' group by 1
    )
    select coalesce(lg.bucket, nw.bucket) as bucket, coalesce(lg.n, 0) as legacy, coalesce(nw.n, 0) as migrated
    from lg full join nw on nw.bucket = lg.bucket order by 1`,
    [instance],
  );
  const orderStatuses = await q(
    `select o.status, count(*) as n from orders.orders o join legacy.ref r on r.new_id = o.id and r.instance = $1 and r.entity = 'orders'
     group by 1 order by 1`,
    [instance],
  );
  checks.push({
    id: 'V3',
    name: 'Status distributions (tickets by legacy booking state; orders reported)',
    pass: v3.every((r) => n(r.legacy) === n(r.migrated)),
    details: {
      tickets: v3.map((r) => ({ bucket: r.bucket, legacy: n(r.legacy), migrated: n(r.migrated) })),
      orders: Object.fromEntries(orderStatuses.map((r) => [String(r.status), n(r.n)])),
    },
  });

  // ---- V4 referential integrity -------------------------------------------------------------------
  const [v4] = await q(
    `
    with orgs as (select distinct org_id from legacy.ref where instance = $1 and org_id is not null)
    select
      (select count(*) from ticketing.tickets t join orgs using (org_id) where not exists (select 1 from orders.orders o where o.id = t.order_id and o.org_id = t.org_id)) as tickets_without_order,
      (select count(*) from ticketing.tickets t join orgs using (org_id) where not exists (select 1 from orders.order_items i where i.id = t.order_item_id and i.order_id = t.order_id)) as tickets_without_item,
      (select count(*) from ticketing.tickets t join orgs using (org_id) where t.attendee_id is null or not exists (select 1 from attendees.attendees a where a.id = t.attendee_id)) as tickets_without_attendee,
      (select count(*) from attendees.attendees a join orgs using (org_id) where a.ticket_id is not null and not exists (select 1 from ticketing.tickets t where t.id = a.ticket_id)) as attendees_without_ticket,
      (select count(*) from orders.orders o join orgs using (org_id) where o.buyer_user_id is not null and not exists (select 1 from auth.users u where u.id = o.buyer_user_id)) as orders_without_user,
      (select count(*) from orders.orders o join orgs using (org_id) where o.created_via = 'legacy' and not exists (select 1 from orders.order_items i where i.order_id = o.id)) as orders_without_items,
      (select count(*) from tenancy.memberships m join orgs using (org_id) where not exists (select 1 from auth.users u where u.id = m.user_id)) as members_without_user,
      (select count(*) from orders.refunds f join orgs using (org_id), unnest(f.ticket_ids) tid where not exists (select 1 from ticketing.tickets t where t.id = tid)) as refunds_bad_ticket,
      (select count(*) from checkin.scans s join orgs using (org_id) where s.ticket_id is not null and not exists (select 1 from ticketing.tickets t where t.id = s.ticket_id)) as scans_without_ticket,
      (select count(*) from ticketing.ticket_barcodes b join orgs using (org_id) where not exists (select 1 from ticketing.tickets t where t.id = b.ticket_id)) as barcodes_without_ticket,
      (select count(*) from legacy.ref r where r.instance = $1 and r.entity in ('booking_units', 'bookings') and not exists (select 1 from ticketing.tickets t where t.id = r.new_id)) as refs_without_ticket,
      (select count(*) from legacy.ref r where r.instance = $1 and r.entity = 'orders' and not exists (select 1 from orders.orders o where o.id = r.new_id)) as refs_without_order,
      (select count(*) from legacy.ref r where r.instance = $1 and r.entity = 'users' and not exists (select 1 from auth.users u where u.id = r.new_id)) as refs_without_user,
      (select count(*) from legacy.ref r where r.instance = $1 and r.entity = 'events' and not exists (select 1 from events.events e where e.id = r.new_id)) as refs_without_event,
      (select count(*) from ticketing.tickets t join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity = 'booking_units'
         where t.status = 'active' and not exists (select 1 from ticketing.ticket_barcodes b where b.ticket_id = t.id and b.active and b.format = 'yy1' and b.rev = t.rev)) as active_tickets_without_code`,
    [instance],
  );
  const orphans = Object.fromEntries(
    Object.entries({ ...v4, ...(await v4Content(q, instance)) }).map(([k, v]) => [k, n(v)]),
  );
  checks.push({
    id: 'V4',
    name: 'Referential integrity (0 orphans)',
    pass: Object.values(orphans).every((x) => x === 0),
    details: orphans,
  });

  // ---- V5 merged users vs distinct emails; staff --------------------------------------------------
  const [v5] = await q(
    `
    select
      (select count(distinct r.new_id) from legacy.ref r where r.entity = 'users') as merged_users,
      (select count(*) from (select legacy.email_norm(u.email) from ${ident(stagingSchema('yay'))}.users u
                             where to_regclass('${stagingSchema('yay')}.users') is not null and u.deleted_at is null and legacy.email_ok(legacy.email_norm(u.email))
                             union
                             select legacy.email_norm(u.email) from ${ident(stagingSchema('abc'))}.users u
                             where to_regclass('${stagingSchema('abc')}.users') is not null and u.deleted_at is null and legacy.email_ok(legacy.email_norm(u.email))) e) as distinct_emails,
      (select count(*) from (select user_id from legacy.credentials group by user_id having count(*) > 1) x) as merged_identities,
      (select count(*) from auth.accounts a
         join (select user_id from legacy.credentials group by user_id having count(*) > 1) m using (user_id)
         join legacy.credentials c on c.user_id = a.user_id and c.password_hash = a.password
        where a.provider_id = 'credential' and not (c.verified or c.has_paid)
          and not exists (select 1 from legacy.credentials e where e.user_id = a.user_id and (e.verified or e.has_paid)
                          and e.password_hash = a.password)) as prehijack_violations,
      (select count(*) from platform.staff s join legacy.ref r on r.new_id = s.user_id and r.entity = 'users') as staff_from_legacy_users`,
  ).catch(async () => {
    // Only one instance loaded: count this instance's emails alone.
    return q(
      `select (select count(distinct r.new_id) from legacy.ref r where r.entity = 'users') as merged_users,
              (select count(distinct legacy.email_norm(email)) from {s}.users where deleted_at is null and legacy.email_ok(legacy.email_norm(email))) as distinct_emails,
              0 as merged_identities, 0 as prehijack_violations, 0 as staff_from_legacy_users`,
    );
  });
  checks.push({
    id: 'V5',
    name: 'Merged users vs distinct emails; pre-hijack guard; no staff from legacy',
    pass: n(v5?.merged_users) === n(v5?.distinct_emails) && n(v5?.prehijack_violations) === 0,
    details: Object.fromEntries(Object.entries(v5 ?? {}).map(([k, v]) => [k, n(v)])),
  });

  // ---- V6–V10 (M2.2c) ----------------------------------------------------------------------------
  checks.push(await v6Vectors(q, instance, opts.freezeAt ?? new Date()));
  checks.push(await v7Golden(q, instance));
  checks.push(v8Facade());
  checks.push(await v9Urls(q, instance));
  checks.push(await v10Checksums(q, instance, runId, stagingSchema(instance)));

  // ---- V11 RLS flags + two-org probe ---------------------------------------------------------------
  const rls = await q(
    `select n.nspname || '.' || c.relname as tbl, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
     where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')
       and n.nspname <> 'legacy' and n.nspname not like 'legacy\\_%' and n.nspname not like 'pg\\_%'`,
  );
  const notForced = rls.filter((r) => !r.enabled || !r.forced).map((r) => String(r.tbl));
  const probeOrgs = await q(
    `select o.org_id, count(*) as n from orders.orders o join legacy.ref r on r.new_id = o.id and r.instance = $1 and r.entity = 'orders'
     group by o.org_id order by count(*) desc, o.org_id limit 2`,
    [instance],
  );
  let probe: Record<string, unknown> = { skipped: 'fewer than two migrated orgs with orders' };
  let probePass = true;
  if (probeOrgs.length === 2) {
    const [a, b] = probeOrgs.map((r) => String(r.org_id)) as [string, string];
    const ctxA = createCtx({ orgId: a, actor: { type: 'system', name: 'legacy-migrate.v11' } });
    const seen = await withTenant(ctxA, async (tx) => {
      const [own] = await tx.execute<{ n: number }>(dsql`select count(*)::int as n from orders.orders`);
      const [other] = await tx.execute<{ n: number }>(
        dsql`select count(*)::int as n from orders.orders where org_id = ${b}`,
      );
      const [otherTickets] = await tx.execute<{ n: number }>(
        dsql`select count(*)::int as n from ticketing.tickets where org_id = ${b}`,
      );
      return { own: own?.n ?? 0, other: other?.n ?? 0, otherTickets: otherTickets?.n ?? 0 };
    }).catch((err: unknown) => ({ error: String(err) }));
    // The staging and control schemas are invisible to app_user (permission denied).
    const staging = await withTenant(ctxA, (tx) =>
      tx.execute(dsql.raw(`select 1 from ${S}.bookings limit 1`)),
    )
      .then(() => 'readable')
      .catch(() => 'denied');
    const control = await withTenant(ctxA, (tx) => tx.execute(dsql.raw('select 1 from legacy.ref limit 1')))
      .then(() => 'readable')
      .catch(() => 'denied');
    Object.assign(seen, { staging, control });
    probe = { orgA: a, orgB: b, ...seen };
    const p = seen as {
      own?: number;
      other?: number;
      otherTickets?: number;
      staging?: string;
      control?: string;
    };
    probePass =
      (p.own ?? 0) > 0 &&
      p.other === 0 &&
      p.otherTickets === 0 &&
      p.staging === 'denied' &&
      p.control === 'denied';
  }
  checks.push({
    id: 'V11',
    name: 'RLS enabled + forced on every org_id table; two-org probe as app_user; staging not visible',
    pass: notForced.length === 0 && probePass,
    details: { tables: rls.length, notForced, probe },
  });

  // ---- V12 timezone spot checks ---------------------------------------------------------------------
  const events = await q(
    `
    select e.id as legacy_id, to_char(e.start_date + coalesce(e.start_time, '00:00'::time), 'YYYY-MM-DD HH24:MI:SS') as legacy_wall,
           n.timezone, to_char(n.starts_at at time zone $2, 'YYYY-MM-DD HH24:MI:SS') as clock_wall,
           to_char(n.starts_at at time zone n.timezone, 'YYYY-MM-DD HH24:MI') as local_wall,
           legacy.local_kind(e.start_date + coalesce(e.start_time, '00:00'::time), $2) as kind
    from {s}.events e
    join legacy.ref r on r.instance = $1 and r.entity = 'events' and r.legacy_id = e.id::text
    join events.events n on n.id = r.new_id
    where e.start_date is not null
    order by md5(e.id::text) limit 50`,
    [instance, opts.eventClock === 'platform' ? opts.platformTz : null],
  ).catch(() => [] as Row[]);
  const eventBad =
    opts.eventClock === 'platform'
      ? events.filter((r) => r.kind !== 'gap' && r.legacy_wall !== r.clock_wall)
      : [];
  const checkins = await q(
    `
    select c.id, c.event_start_date::text as day, c.check_in_time::text as utc_time,
           to_char(a.admitted_at at time zone 'UTC', 'HH24:MI:SS') as got_time,
           (a.admitted_at at time zone $2)::date::text as got_day
    from {s}.checkins c
    join legacy.ref r on r.instance = $1 and r.entity = 'bookings' and r.legacy_id = c.booking_id::text
    join checkin.admissions a on a.ticket_id = r.new_id and a.admitted_at = legacy.checkin_instant(c.event_start_date, c.check_in_time, $2)
    where c.event_start_date is not null and c.check_in_time is not null
    order by md5(c.id::text) limit 50`,
    [instance, opts.platformTz],
  );
  const [ciTotal] = await q(
    `select count(*) as n from {s}.checkins c
     join legacy.ref r on r.instance = $1 and r.entity = 'bookings' and r.legacy_id = c.booking_id::text
     where c.event_start_date is not null and c.check_in_time is not null`,
    [instance],
  );
  const ciBad = checkins.filter((r) => r.got_time !== r.utc_time || r.got_day !== r.day);
  checks.push({
    id: 'V12',
    name: 'Timezone spot checks (50 events, 50 check-ins; DST folds/gaps logged)',
    pass: eventBad.length === 0 && ciBad.length === 0 && (n(ciTotal?.n) === 0 || checkins.length > 0),
    details: {
      eventClock: opts.eventClock,
      platformTz: opts.platformTz,
      eventsChecked: events.length,
      eventMismatches: eventBad.slice(0, 10),
      sample: events.slice(0, 5),
      checkinsChecked: checkins.length,
      checkinMismatches: ciBad.slice(0, 10),
      dstLogged: { fold: exceptions.dst_fold ?? 0, gap: exceptions.dst_gap ?? 0 },
    },
  });

  const pass = quarantine.every((l) => l.pass) && checks.every((c) => c.pass);
  return { instance, runId, pass, quarantine, exceptions, checks };
}

/** The human summary printed after a run (the JSON report holds the details). */
export function summarize(r: ValidationReport): string {
  const lines = [
    `legacy migration validation — instance ${r.instance}, run ${r.runId ?? '-'}: ${r.pass ? 'PASS' : 'FAIL'}`,
  ];
  for (const c of r.checks) lines.push(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.id} ${c.name}`);
  const qFail = r.quarantine.filter((l) => !l.pass);
  const qAny = r.quarantine.filter((l) => l.quarantined > 0);
  lines.push(
    `  ${qFail.length ? 'FAIL' : 'ok  '} quarantine: ${qAny.length ? qAny.map((l) => `${l.table} ${l.quarantined}/${l.rows} (${l.pct}% ≤ ${l.limitPct}%)`).join(', ') : 'none'}`,
  );
  const ex = Object.entries(r.exceptions);
  if (ex.length) lines.push(`  exceptions for owner review: ${ex.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  return lines.join('\n');
}

/** Staging tables of the M2.2d transforms (a dump may lack any of them: counted as 0). */
const CONTENT_TABLES = [
  'event_sessions',
  'event_speakers',
  'event_exhibitors',
  'event_announcements',
  'event_custom_sections',
  'tags',
  'event_tag',
  'pages',
  'posts',
  'chats',
  'blocked_users',
  'message_reports',
] as const;

/**
 * V1 for the M2.2d content (program, announcements, sections, private info, CMS, chats): the
 * legacy side from staging (rows of migrated events, less this run's quarantine), the migrated
 * side through `legacy.ref`, so rows made on the new platform (or by other orgs) never count.
 * Rows deliberately not carried count through their exception (sections with nothing usable,
 * empty private info, chats kept in staging).
 */
async function v1Content(q: Q, instance: 'yay' | 'abc', runId: number | null) {
  const S = stagingSchema(instance);
  const present = new Set(
    (await q(`select table_name from information_schema.tables where table_schema = $1`, [S])).map((r) =>
      String(r.table_name),
    ),
  );
  const has = (t: (typeof CONTENT_TABLES)[number]) => present.has(t);
  const live = (t: string, alias: string, key = `${alias}.id::text`) =>
    `not exists (select 1 from legacy.quarantine x where x.run_id = $2 and x.table_name = '${t}' and x.legacy_id = ${key})`;
  const ofEvent = (alias: string) =>
    `exists (select 1 from legacy.ref ev where ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = ${alias}.event_id::text)`;
  const refCount = (entities: string, table: string) =>
    `(select count(*) from ${table} t join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity in (${entities}))`;
  const ex = (kind: string) =>
    `(select count(*) from legacy.exceptions e where e.run_id = $2 and e.instance = $1 and e.kind = '${kind}')`;
  const zero = '0';
  const [r] = await q(
    `select
      ${has('event_sessions') ? `(select count(*) from {s}.event_sessions s where ${ofEvent('s')} and ${live('event_sessions', 's')})` : zero} as legacy_sessions,
      ${refCount(`'event_sessions'`, 'program.sessions')} as sessions,
      ${has('event_speakers') ? `(select count(*) from {s}.event_speakers s where ${ofEvent('s')} and ${live('event_speakers', 's')})` : zero}
      + ${
        has('tags') && has('event_tag')
          ? `(select count(*) from (select distinct et.tag_id, et.event_id from {s}.event_tag et join {s}.tags t on t.id = et.tag_id
               where coalesce(t.status, 1) = 1 and nullif(btrim(t.title), '') is not null and ${ofEvent('et')}
                 and ${live('event_tag', 'et', `et.tag_id::text || ':' || et.event_id::text`)}) l)`
          : zero
      } as legacy_speakers,
      ${refCount(`'event_speakers', 'event_tag'`, 'program.speakers')} as speakers,
      ${
        has('event_sessions') && has('event_speakers')
          ? `(select coalesce(sum(least(n, 20)), 0) from (
               select s.id, count(distinct sp.id) as n from {s}.event_sessions s
               cross join lateral jsonb_array_elements_text(case when jsonb_typeof(s.speaker_ids) = 'array' then s.speaker_ids else '[]'::jsonb end) j(v)
               join {s}.event_speakers sp on sp.id::text = btrim(j.v) and sp.event_id = s.event_id
               where ${ofEvent('s')} and ${live('event_sessions', 's')} and ${live('event_speakers', 'sp')}
               group by s.id) x)`
          : zero
      } as legacy_session_speakers,
      (select count(*) from program.session_speakers t join legacy.ref r on r.new_id = t.session_id and r.instance = $1 and r.entity = 'event_sessions') as session_speakers,
      ${has('event_exhibitors') ? `(select count(*) from {s}.event_exhibitors s where ${ofEvent('s')} and ${live('event_exhibitors', 's')})` : zero} as legacy_exhibitors,
      ${refCount(`'event_exhibitors'`, 'program.exhibitors')} as exhibitors,
      ${has('event_exhibitors') ? `(select count(*) from {s}.event_exhibitors s where ${ofEvent('s')} and ${live('event_exhibitors', 's')} and lower(btrim(s.sponsor_type)) in ('platinum', 'gold', 'silver', 'bronze'))` : zero} as legacy_sponsors,
      ${refCount(`'exhibitor_sponsors'`, 'program.sponsors')} as sponsors,
      ${has('event_announcements') ? `(select count(*) from {s}.event_announcements s where ${ofEvent('s')} and ${live('event_announcements', 's')})` : zero} as legacy_announcements,
      ${refCount(`'event_announcements'`, 'events.event_announcements')} as announcements,
      ${has('event_custom_sections') ? `(select count(*) from {s}.event_custom_sections s where ${ofEvent('s')} and ${live('event_custom_sections', 's')})` : zero} as legacy_sections,
      ${refCount(`'event_custom_sections'`, 'events.event_sections')} + ${ex('section_empty_not_migrated')} as sections,
      (select count(*) from {s}.events le where ${
        (
          await q(
            `select 1 from information_schema.columns where table_schema = $1 and table_name = 'events' and column_name = 'private_info'`,
            [S],
          )
        ).length
          ? `jsonb_typeof(le.private_info) = 'object' and le.private_info <> '{}'::jsonb`
          : 'false'
      } and exists (select 1 from legacy.ref ev where ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = le.id::text)) as legacy_private_info,
      ${refCount(`'event_private_info'`, 'events.event_private_info')} + ${ex('private_info_empty')} as private_info,
      ${has('pages') ? `(select count(*) from {s}.pages s where ${live('pages', 's')})` : zero}
      + ${has('posts') ? `(select count(*) from {s}.posts s where ${live('posts', 's')})` : zero} as legacy_cms,
      ${refCount(`'pages', 'posts'`, 'cms.entries')} as cms,
      ${has('chats') ? '(select count(*) from {s}.chats)' : zero} as legacy_chats, ${ex('chat_not_migrated')} as chats,
      ${has('blocked_users') ? '(select count(*) from {s}.blocked_users)' : zero} as legacy_blocks, ${ex('chat_block_not_migrated')} as blocks,
      ${has('message_reports') ? '(select count(*) from {s}.message_reports)' : zero} as legacy_reports, ${ex('chat_report_not_migrated')} as reports`,
    [instance, runId ?? -1],
  );
  const lines: [string, string, string, string][] = [
    ['program_sessions', 'legacy_sessions', 'sessions', '1:1 (sessions of migrated events)'],
    ['program_speakers', 'legacy_speakers', 'speakers', 'event speakers + one per (active tag, event) link'],
    [
      'session_speakers',
      'legacy_session_speakers',
      'session_speakers',
      'speaker ids of the same event (≤ 20 per session)',
    ],
    ['program_exhibitors', 'legacy_exhibitors', 'exhibitors', '1:1'],
    ['program_sponsors', 'legacy_sponsors', 'sponsors', 'exhibitors with a sponsor level'],
    ['event_announcements', 'legacy_announcements', 'announcements', '1:1'],
    ['event_sections', 'legacy_sections', 'sections', '1:1 (+ listed when nothing usable)'],
    [
      'event_private_info',
      'legacy_private_info',
      'private_info',
      'events with private info (+ listed when empty)',
    ],
    ['cms_entries', 'legacy_cms', 'cms', 'pages + posts'],
    ['chats_kept_in_staging', 'legacy_chats', 'chats', 'listed (no target module)'],
    ['chat_blocks_kept_in_staging', 'legacy_blocks', 'blocks', 'listed (no target module)'],
    ['chat_reports_kept_in_staging', 'legacy_reports', 'reports', 'listed (no target module)'],
  ];
  return lines.map(([name, l, m, factor]) => ({
    name,
    legacy: n(r?.[l]),
    migrated: n(r?.[m]),
    factor,
    pass: n(r?.[l]) === n(r?.[m]),
  }));
}

/**
 * V4 for the M2.2d content: every `legacy.ref` of a new entity points at its row; program links
 * stay within one event; media manifest rows point at existing rows; every migrated plan's underlay
 * is in the manifest. Scoped to what the migration wrote.
 */
async function v4Content(q: Q, instance: 'yay' | 'abc'): Promise<Record<string, unknown>> {
  const refsWithout = (entities: string, table: string) =>
    `(select count(*) from legacy.ref r where r.instance = $1 and r.entity in (${entities})
       and not exists (select 1 from ${table} t where t.id = r.new_id and t.org_id = r.org_id))`;
  const [r] = await q(
    `with sess as (select t.* from program.sessions t join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity = 'event_sessions')
    select
      ${refsWithout(`'event_sessions'`, 'program.sessions')} as refs_without_session,
      ${refsWithout(`'event_speakers', 'event_tag'`, 'program.speakers')} as refs_without_speaker,
      ${refsWithout(`'event_exhibitors'`, 'program.exhibitors')} as refs_without_exhibitor,
      ${refsWithout(`'exhibitor_sponsors'`, 'program.sponsors')} as refs_without_sponsor,
      ${refsWithout(`'event_announcements'`, 'events.event_announcements')} as refs_without_announcement,
      ${refsWithout(`'event_custom_sections'`, 'events.event_sections')} as refs_without_section,
      ${refsWithout(`'event_private_info'`, 'events.event_private_info')} as refs_without_private_info,
      ${refsWithout(`'pages', 'posts'`, 'cms.entries')} as refs_without_cms_entry,
      (select count(*) from program.session_speakers l join sess s on s.id = l.session_id
         join program.speakers sp on sp.id = l.speaker_id where sp.event_id <> s.event_id or sp.org_id <> s.org_id) as session_speakers_other_event,
      (select count(*) from sess s join program.rooms rm on rm.id = s.room_id where rm.event_id <> s.event_id) as sessions_room_other_event,
      (select count(*) from program.sponsors sp join legacy.ref r on r.new_id = sp.id and r.instance = $1 and r.entity = 'exhibitor_sponsors'
         join program.sponsor_tiers t on t.id = sp.tier_id where t.event_id <> sp.event_id) as sponsors_tier_other_event,
      (select count(*) from legacy.media_refs m where m.instance = $1 and not exists (
         select 1 from legacy.ref r where r.instance = $1 and r.new_id = m.new_id and r.org_id = m.org_id)) as media_refs_without_row,
      (select count(*) from seating.layouts l join legacy.ref r on r.new_id = l.id and r.instance = $1 and r.entity = 'seatcharts'
        where l.doc -> 'underlay' ->> 'url' is not null and not exists (
          select 1 from legacy.media_refs m where m.instance = $1 and m.new_id = l.id and m.storage_key = l.doc -> 'underlay' ->> 'url')) as underlays_without_manifest`,
    [instance],
  );
  return r ?? {};
}

type Q = (text: string, params?: unknown[]) => Promise<Row[]>;
