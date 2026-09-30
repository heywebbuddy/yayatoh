/**
 * V7 golden queries (roadmap §7.5; M2.2c): business numbers an organizer or the owner would check
 * after cutover, computed twice — from the legacy staging tables (`{s}`) and from the new tables —
 * per organizer (org) or per event. Each query returns `key`, `legacy` and `migrated`; the check
 * passes with 0 differences. `$1` is the instance. The legacy side never reads the transforms'
 * output except `legacy.ref` to name the org or event a legacy id became.
 */
export interface GoldenQuery {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
  /** Staging tables the query reads beyond the M2.2b core (skipped, and reported, when absent). */
  readonly requires?: readonly string[];
}

// Legacy organizer of a booking row → its org; bookings that are not hand-ons.
const LB = `
  from {s}.bookings b
  join legacy.ref ev on ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = b.event_id::text
  where b.distributed_from_booking_id is null`;
const ACTIVE = `coalesce(b.booking_cancel, 0) < 2 and coalesce(b.status, 1) = 1 and coalesce(b.is_paid, 1) = 1`;
const NEW_ORDERS = `
  from orders.orders o join legacy.ref r on r.instance = $1 and r.entity = 'orders' and r.new_id = o.id`;
const NEW_TICKETS = `
  from ticketing.tickets t join legacy.ref r on r.instance = $1 and r.entity = 'booking_units' and r.new_id = t.id`;

/**
 * Orgs this instance's migration wrote events for: settlement rows of any other org (test
 * fixtures that share the instance tag) are not the migration's output.
 */
const MIGRATED_ORGS = `select r.org_id from legacy.ref r where r.instance = $1 and r.entity = 'events'`;

const pair = (legacy: string, migrated: string) => `
  with l as (${legacy}), m as (${migrated})
  select coalesce(l.key, m.key) as key, coalesce(l.v, 0)::bigint as legacy, coalesce(m.v, 0)::bigint as migrated
  from l full join m on m.key = l.key`;

// M2.2d: a legacy content row of a migrated event, not quarantined by the latest run.
const LIVE = (table: string, alias: string, key = `${alias}.id::text`) => `
  not exists (select 1 from legacy.quarantine q where q.instance = $1 and q.table_name = '${table}' and q.legacy_id = ${key}
              and q.run_id = (select max(id) from legacy.runs where instance = $1))`;
const EV = (alias: string) =>
  `join legacy.ref ev on ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = ${alias}.event_id::text`;
const REF = (entities: string, alias: string) =>
  `join legacy.ref r on r.instance = $1 and r.entity in (${entities}) and r.new_id = ${alias}.id`;

export const GOLDEN_QUERIES: readonly GoldenQuery[] = [
  {
    id: 'G01',
    name: 'Gross sales per org (all checkouts, minor units)',
    sql: pair(
      `select ev.org_id::text as key, sum(round(coalesce(b.net_price, b.price + coalesce(b.tax, 0)) * 100)) as v ${LB} group by 1`,
      `select o.org_id::text as key, sum(o.total_minor) as v ${NEW_ORDERS} group by 1`,
    ),
  },
  {
    id: 'G02',
    name: 'Refunded amount per org',
    sql: pair(
      `select ev.org_id::text as key, sum(round(coalesce(b.net_price, 0) * 100)) as v ${LB} and b.booking_cancel = 3 group by 1`,
      `select f.org_id::text as key, sum(f.amount_minor) as v from orders.refunds f
       join legacy.ref r on r.instance = $1 and r.entity = 'orders' and r.new_id = f.order_id group by 1`,
    ),
  },
  {
    id: 'G03',
    name: 'Promo discounts per org',
    sql: pair(
      `select ev.org_id::text as key, sum(coalesce(legacy.to_minor(nullif(btrim(b.promocode_reward), '')), 0)) as v ${LB} group by 1`,
      `select o.org_id::text as key, sum(o.discount_minor) as v ${NEW_ORDERS} group by 1`,
    ),
  },
  {
    id: 'G04',
    name: 'Valid tickets (attendee count) per org',
    sql: pair(
      `select ev.org_id::text as key, sum(b.quantity) as v ${LB} and ${ACTIVE} group by 1`,
      `select t.org_id::text as key, count(*) as v ${NEW_TICKETS} where t.status = 'active' group by 1`,
    ),
  },
  {
    id: 'G05',
    name: 'Valid tickets (attendee count) per event',
    sql: pair(
      `select ev.new_id::text as key, sum(b.quantity) as v ${LB} and ${ACTIVE} group by 1`,
      `select t.event_id::text as key, count(*) as v ${NEW_TICKETS} where t.status = 'active' group by 1`,
    ),
  },
  {
    id: 'G06',
    name: 'Tickets sold per ticket type (all states)',
    sql: pair(
      `select tt.new_id::text as key, sum(b.quantity) as v
       from {s}.bookings b
       join legacy.ref tt on tt.instance = $1 and tt.entity = 'tickets' and tt.legacy_id = b.ticket_id::text
       where b.distributed_from_booking_id is null group by 1`,
      `select t.ticket_type_id::text as key, count(*) as v ${NEW_TICKETS} group by 1`,
    ),
  },
  {
    id: 'G07',
    name: 'Checkouts (orders) per org',
    sql: pair(
      `select ev.org_id::text as key, count(distinct (b.common_order, b.event_id, b.customer_id)) as v ${LB} group by 1`,
      `select o.org_id::text as key, count(*) as v ${NEW_ORDERS} group by 1`,
    ),
  },
  {
    id: 'G08',
    name: 'Organizer payouts made (transferred earnings) per org',
    sql: pair(
      `select ev.org_id::text as key, sum(round(c.organiser_earning * 100)) as v
       from {s}.commissions c
       join legacy.ref ev on ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = c.event_id::text
       where c.status = 1 and c.transferred = 1 group by 1`,
      `select s.org_id::text as key, sum(s.transferred_minor) as v from payments.legacy_settlements s
       join legacy.ref r on r.instance = $1 and r.entity = 'events' and r.new_id = s.event_id
       where s.kind = 'event_statement' and s.instance = $1 group by 1`,
    ),
  },
  {
    id: 'G09',
    name: 'Organizer balance still owed (opening balances) per org',
    sql: pair(
      `select ev.org_id::text as key, sum(round(c.organiser_earning * 100)) as v
       from {s}.commissions c
       join legacy.ref ev on ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = c.event_id::text
       where c.status = 1 and c.transferred = 0 group by 1`,
      `select s.org_id::text as key, sum(s.open_minor) as v from payments.legacy_settlements s
       where s.kind = 'opening_balance' and s.instance = $1 and s.org_id in (${MIGRATED_ORGS}) group by 1`,
    ),
  },
  {
    id: 'G10',
    name: 'Platform commission per org',
    sql: pair(
      `select ev.org_id::text as key, sum(round(c.admin_commission * 100)) as v
       from {s}.commissions c
       join legacy.ref ev on ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = c.event_id::text
       where c.status = 1 group by 1`,
      `select s.org_id::text as key, sum(s.commission_minor) as v from payments.legacy_settlements s
       join legacy.ref r on r.instance = $1 and r.entity = 'events' and r.new_id = s.event_id
       where s.kind = 'event_statement' and s.instance = $1 group by 1`,
    ),
  },
  {
    id: 'G11',
    name: 'Promo code redemptions per org',
    sql: pair(
      `select ev.org_id::text as key, count(distinct (b.common_order, b.event_id, b.customer_id)) as v ${LB}
       and b.promocode_id is not null and coalesce(legacy.to_minor(nullif(btrim(b.promocode_reward), '')), 0) > 0 group by 1`,
      `select o.org_id::text as key, count(*) as v ${NEW_ORDERS} where o.promo_code_id is not null group by 1`,
    ),
  },
  {
    id: 'G12',
    name: 'Events and ticket types per org',
    sql: pair(
      `select ev.org_id::text as key, count(*) + (select count(*) from {s}.tickets t where t.event_id = any(array_agg(le.id))) as v
       from {s}.events le join legacy.ref ev on ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = le.id::text group by 1`,
      `select e.org_id::text as key, count(*) + (select count(*) from ticketing.ticket_types tt where tt.event_id = any(array_agg(e.id))) as v
       from events.events e join legacy.ref r on r.instance = $1 and r.entity = 'events' and r.new_id = e.id group by 1`,
    ),
  },
  {
    id: 'G13',
    name: 'Checked-in tickets per event (a check-in covers its booking’s units, less those handed on)',
    sql: pair(
      `select ev.new_id::text as key,
              sum(case when b.distributed_from_booking_id is null
                       then greatest(b.quantity - (select count(*) from {s}.bookings h where h.distributed_from_booking_id = b.id), 0)
                       else 1 end) as v
       from (select distinct booking_id from {s}.checkins) c
       join {s}.bookings b on b.id = c.booking_id
       join legacy.ref ev on ev.instance = $1 and ev.entity = 'events' and ev.legacy_id = b.event_id::text
       group by 1`,
      // The imported check-ins (T5's legacy scans), not door scans made since on the new platform.
      `select s.event_id::text as key, count(distinct s.ticket_id) as v from checkin.scans s
       where s.code_kind = 'legacy' and s.client_scan_id like 'legacy:' || $1 || ':%' and s.result = 'admitted' group by 1`,
    ),
  },
  {
    id: 'G14',
    name: 'Distinct buyers per org',
    sql: pair(
      `select ev.org_id::text as key, count(distinct legacy.email_norm(b.customer_email)) filter (where legacy.email_ok(legacy.email_norm(b.customer_email))) as v ${LB} group by 1`,
      `select o.org_id::text as key, count(distinct o.buyer_email) filter (where legacy.email_ok(o.buyer_email)) as v ${NEW_ORDERS} group by 1`,
    ),
  },
  // --- M2.2d: the program, announcements and CMS content --------------------------------------
  {
    id: 'G15',
    requires: ['event_sessions'],
    name: 'Program sessions per event',
    sql: pair(
      `select ev.new_id::text as key, count(*) as v from {s}.event_sessions x ${EV('x')} where ${LIVE('event_sessions', 'x')} group by 1`,
      `select t.event_id::text as key, count(*) as v from program.sessions t ${REF(`'event_sessions'`, 't')} group by 1`,
    ),
  },
  {
    id: 'G16',
    requires: ['event_speakers', 'event_tag', 'tags'],
    name: 'Speakers per event (event speakers and performer tags)',
    sql: pair(
      `select key, sum(v) as v from (
         select ev.new_id::text as key, count(*) as v from {s}.event_speakers x ${EV('x')} where ${LIVE('event_speakers', 'x')} group by 1
         union all
         select ev.new_id::text, count(distinct (x.tag_id, x.event_id)) from {s}.event_tag x ${EV('x')}
         join {s}.tags t on t.id = x.tag_id
         where coalesce(t.status, 1) = 1 and nullif(btrim(t.title), '') is not null
           and ${LIVE('event_tag', 'x', `x.tag_id::text || ':' || x.event_id::text`)} group by 1) u group by 1`,
      `select t.event_id::text as key, count(*) as v from program.speakers t ${REF(`'event_speakers', 'event_tag'`, 't')} group by 1`,
    ),
  },
  {
    id: 'G17',
    requires: ['event_exhibitors'],
    name: 'Exhibitors per event',
    sql: pair(
      `select ev.new_id::text as key, count(*) as v from {s}.event_exhibitors x ${EV('x')} where ${LIVE('event_exhibitors', 'x')} group by 1`,
      `select t.event_id::text as key, count(*) as v from program.exhibitors t ${REF(`'event_exhibitors'`, 't')} group by 1`,
    ),
  },
  {
    id: 'G18',
    requires: ['event_exhibitors'],
    name: 'Sponsors per event and level',
    sql: pair(
      `select ev.new_id::text || '|' || lower(btrim(x.sponsor_type)) as key, count(*) as v from {s}.event_exhibitors x ${EV('x')}
       where lower(btrim(x.sponsor_type)) in ('platinum', 'gold', 'silver', 'bronze') and ${LIVE('event_exhibitors', 'x')} group by 1`,
      `select t.event_id::text || '|' || lower(st.name) as key, count(*) as v from program.sponsors t ${REF(`'exhibitor_sponsors'`, 't')}
       join program.sponsor_tiers st on st.id = t.tier_id group by 1`,
    ),
  },
  {
    id: 'G19',
    requires: ['event_announcements'],
    name: 'Live announcements per event (active in legacy = published)',
    sql: pair(
      `select ev.new_id::text as key, count(*) as v from {s}.event_announcements x ${EV('x')}
       where coalesce(x.is_active, 1) = 1 and ${LIVE('event_announcements', 'x')} group by 1`,
      `select t.event_id::text as key, count(*) as v from events.event_announcements t ${REF(`'event_announcements'`, 't')}
       where t.published_at is not null group by 1`,
    ),
  },
  {
    id: 'G20',
    requires: ['event_sessions', 'event_speakers'],
    name: 'Session speaker links per event',
    sql: pair(
      `select ev.new_id::text as key, count(distinct (s.id, sp.id)) as v from {s}.event_sessions s ${EV('s')}
       cross join lateral jsonb_array_elements_text(case when jsonb_typeof(s.speaker_ids) = 'array' then s.speaker_ids else '[]'::jsonb end) j(v)
       join {s}.event_speakers sp on sp.id::text = btrim(j.v) and sp.event_id = s.event_id
       where ${LIVE('event_sessions', 's')} and ${LIVE('event_speakers', 'sp')} group by 1`,
      `select t.event_id::text as key, count(*) as v from program.session_speakers l
       join program.sessions t on t.id = l.session_id ${REF(`'event_sessions'`, 't')} group by 1`,
    ),
  },
  {
    id: 'G21',
    requires: ['pages', 'posts'],
    name: 'Published CMS pages and posts per owning org (author’s org, else the platform org)',
    sql: pair(
      `select coalesce(o.org_id, p.org_id)::text as key, count(*) as v from (
         select id, author_id, 'pages' as tbl, status::text = 'ACTIVE' as live from {s}.pages
         union all select id, author_id, 'posts', status::text = 'PUBLISHED' from {s}.posts) x
       left join legacy.ref o on o.instance = $1 and o.entity = 'organizers' and o.legacy_id = x.author_id::text
       left join (select new_id as org_id from legacy.ref
                  where instance = $1 and ((instance = 'yay' and entity = 'platform_org') or (instance = 'abc' and entity = 'organizers' and legacy_id = 'parent'))
                  limit 1) p on true
       where x.live and not exists (select 1 from legacy.quarantine q where q.instance = $1 and q.table_name = x.tbl
         and q.legacy_id = x.id::text and q.run_id = (select max(id) from legacy.runs where instance = $1))
       group by 1`,
      `select t.org_id::text as key, count(*) as v from cms.entries t ${REF(`'pages', 'posts'`, 't')} where t.status = 'published' group by 1`,
    ),
  },
];
