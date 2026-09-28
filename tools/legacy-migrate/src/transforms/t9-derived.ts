import { exec, type StepContext } from './context.ts';

/**
 * T9 Derived data (roadmap §7.5, M2.2c), for the orders, tickets and check-ins this instance
 * migrated. Contacts were built in T4 (buyers and holders) and T6 (newsletter).
 *
 * - **`crm.event_participation`** per contact × event: tickets held (active), their types, a seat,
 *   a check-in, the first registration and what they spent as the buyer (net of refunds).
 * - **`crm.contact_stats`** per contact × currency: orders, tickets, events, events attended,
 *   spend, first and last seen.
 * - **`crm.contact_profile`** (M3.6) rebuilt for the migrated orgs' contacts.
 * - **`platform.metric_timeseries`**, monthly in the org's timezone: `sales.gross`,
 *   `sales.refunds` (per currency), `orders.sold`, `tickets.sold`, `checkins.tickets`, so reports
 *   have the legacy years for year-over-year comparisons.
 * - **`platform.domain_events`** backfilled with `replayed = true`: `order.paid`, `order.refunded`
 *   and `ticket.admitted` in their live v1 shapes, at their historic times. They are stamped into
 *   the log (under the relay's lock, so `log_seq` stays gap-free) and marked published: the relay
 *   never enqueues them, and every subscriber that does not opt in skips them, so no email,
 *   notification or journey fires for history.
 * Rows carry `source = 'legacy'` and are rebuilt on each run (idempotent).
 */
export async function t9Derived(ctx: StepContext): Promise<void> {
  await exec(
    ctx,
    `
    drop table if exists t9_orders;
    create temp table t9_orders as
    select o.id, o.org_id, o.event_id, o.buyer_contact_id, o.status, o.currency, o.total_minor,
           coalesce((select sum(f.amount_minor) from orders.refunds f where f.org_id = o.org_id and f.order_id = o.id and f.status = 'succeeded'), 0) as refunded,
           o.paid_at, o.created_at
    from orders.orders o
    join legacy.ref r on r.instance = {inst} and r.entity = 'orders' and r.new_id = o.id;
    create index on t9_orders (id);
    analyze t9_orders;

    drop table if exists t9_tickets;
    create temp table t9_tickets as
    select t.id, t.org_id, t.event_id, t.order_id, t.ticket_type_id, t.status, t.seat_label, t.created_at, a.contact_id,
           exists (select 1 from checkin.admissions ad where ad.org_id = t.org_id and ad.ticket_id = t.id and ad.undone_at is null) as checked_in
    from ticketing.tickets t
    join t9_orders o on o.id = t.order_id
    left join attendees.attendees a on a.org_id = t.org_id and a.id = t.attendee_id;
    analyze t9_tickets;

    drop table if exists t9_part;
    create temp table t9_part as
    with held as (
      select org_id, contact_id, event_id,
             array_agg(distinct ticket_type_id) filter (where status = 'active') as types,
             count(*) filter (where status = 'active') as tickets,
             bool_or(seat_label is not null and status = 'active') as has_seat,
             bool_or(checked_in) as checked_in,
             min(created_at) as registered_at
      from t9_tickets where contact_id is not null group by 1, 2, 3
    ), bought as (
      select org_id, buyer_contact_id as contact_id, event_id,
             sum(case when status in ('paid', 'partially_refunded', 'refunded') then greatest(total_minor - refunded, 0) else 0 end) as spend,
             min(created_at) as registered_at, count(*) filter (where status in ('paid', 'partially_refunded')) as orders
      from t9_orders where buyer_contact_id is not null group by 1, 2, 3
    )
    select coalesce(h.org_id, b.org_id) as org_id, coalesce(h.contact_id, b.contact_id) as contact_id,
           coalesce(h.event_id, b.event_id) as event_id,
           coalesce(h.types, '{}'::uuid[]) as types, coalesce(h.tickets, 0)::int as tickets,
           coalesce(h.has_seat, false) as has_seat, coalesce(h.checked_in, false) as checked_in,
           least(h.registered_at, b.registered_at) as registered_at, coalesce(b.spend, 0)::bigint as spend,
           coalesce(b.orders, 0)::int as orders, e.currency
    from held h full join bought b on b.org_id = h.org_id and b.contact_id = h.contact_id and b.event_id = h.event_id
    join events.events e on e.id = coalesce(h.event_id, b.event_id);

    delete from crm.event_participation p using t9_part x
    where p.org_id = x.org_id and p.contact_id = x.contact_id and p.event_id = x.event_id and p.source = 'legacy';
    insert into crm.event_participation (id, org_id, contact_id, event_id, ticket_type_ids, tickets, has_seat, checked_in,
                                         registered_at, spend_minor, currency, source, registered, orders,
                                         created_at, updated_at)
    select legacy.det_uuid(registered_at, {inst} || '|event_participation|' || contact_id || '|' || event_id), org_id, contact_id,
           event_id, types, tickets, has_seat, checked_in, registered_at, spend, currency, 'legacy', tickets > 0, orders,
           now(), now()
    from t9_part
    on conflict (org_id, contact_id, event_id) do nothing;

    delete from crm.contact_stats s
    where s.source = 'legacy' and exists (select 1 from t9_part x where x.org_id = s.org_id and x.contact_id = s.contact_id);
    insert into crm.contact_stats (id, org_id, contact_id, currency, orders, tickets, events, events_attended, spend_minor,
                                   first_seen_at, last_seen_at, source, created_at, updated_at)
    select legacy.det_uuid(min(registered_at), {inst} || '|contact_stats|' || contact_id || '|' || currency), org_id, contact_id,
           currency, sum(orders)::int, sum(tickets)::int, count(*)::int, count(*) filter (where checked_in)::int, sum(spend)::bigint,
           min(registered_at), max(registered_at), 'legacy', now(), now()
    from t9_part group by org_id, contact_id, currency
    on conflict (org_id, contact_id, currency) do nothing;

    -- M3.6 contact profiles of the migrated contacts, from the rows above and the consent ledger.
    select crm.refresh_contact_profiles(o.org_id, null) from (select distinct org_id from t9_part) o;

    -- Monthly metrics (org timezone).
    delete from platform.metric_timeseries m
    where m.source = 'legacy' and m.org_id in (select distinct org_id from t9_orders);
    insert into platform.metric_timeseries (id, org_id, metric, bucket, currency, value, source)
    select legacy.det_uuid(x.bucket::timestamptz, {inst} || '|metric|' || x.org_id || '|' || x.metric || '|' || x.bucket || '|' || x.currency),
           x.org_id, x.metric, x.bucket, x.currency, x.value, 'legacy'
    from (
      select o.org_id, 'sales.gross' as metric, date_trunc('month', o.paid_at at time zone g.timezone)::date as bucket, o.currency, sum(o.total_minor)::bigint as value
      from t9_orders o join tenancy.organizations g on g.id = o.org_id
      where o.paid_at is not null and o.status in ('paid', 'partially_refunded', 'refunded') group by 1, 2, 3, 4
      union all
      select f.org_id, 'sales.refunds', date_trunc('month', f.completed_at at time zone g.timezone)::date, f.currency, sum(f.amount_minor)::bigint
      from orders.refunds f join t9_orders o on o.id = f.order_id join tenancy.organizations g on g.id = f.org_id
      where f.status = 'succeeded' and f.completed_at is not null group by 1, 2, 3, 4
      union all
      select o.org_id, 'orders.sold', date_trunc('month', o.paid_at at time zone g.timezone)::date, '', count(*)::bigint
      from t9_orders o join tenancy.organizations g on g.id = o.org_id
      where o.paid_at is not null and o.status in ('paid', 'partially_refunded', 'refunded') group by 1, 2, 3, 4
      union all
      select t.org_id, 'tickets.sold', date_trunc('month', o.paid_at at time zone g.timezone)::date, '', count(*)::bigint
      from t9_tickets t join t9_orders o on o.id = t.order_id join tenancy.organizations g on g.id = t.org_id
      where t.status = 'active' and o.paid_at is not null group by 1, 2, 3, 4
      union all
      select a.org_id, 'checkins.tickets', date_trunc('month', a.admitted_at at time zone g.timezone)::date, '', count(distinct a.ticket_id)::bigint
      from checkin.admissions a join t9_tickets t on t.id = a.ticket_id join tenancy.organizations g on g.id = a.org_id
      where a.undone_at is null group by 1, 2, 3, 4
    ) x
    on conflict (org_id, metric, bucket, currency, source) do update set value = excluded.value;
  `,
  );

  // History in the outbox, replayed: logged, never delivered to mailers or journeys.
  await exec(
    ctx,
    `
    drop table if exists t9_events;
    create temp table t9_events as
    select legacy.det_uuid(o.paid_at, {inst} || '|domain_events|order.paid|' || o.id) as id, o.org_id, 'order.paid' as type,
           'order' as aggregate_type, o.id::text as aggregate_id,
           jsonb_build_object('orgId', o.org_id, 'orderId', o.id, 'eventId', o.event_id, 'totalMinor', o.total_minor,
                              'currency', o.currency, 'via', 'legacy') as payload, o.paid_at as at
    from t9_orders o where o.paid_at is not null
    union all
    select legacy.det_uuid(f.created_at, {inst} || '|domain_events|order.refunded|' || f.id), f.org_id, 'order.refunded', 'order',
           f.order_id::text,
           jsonb_build_object('orgId', f.org_id, 'orderId', f.order_id, 'refundId', f.id, 'amountMinor', f.amount_minor,
                              'currency', f.currency, 'tickets', cardinality(f.ticket_ids), 'fully', o.status = 'refunded'),
           f.created_at
    from orders.refunds f join t9_orders o on o.id = f.order_id
    union all
    select legacy.det_uuid(a.admitted_at, {inst} || '|domain_events|ticket.admitted|' || a.id), a.org_id, 'ticket.admitted', 'ticket',
           a.ticket_id::text,
           jsonb_build_object('orgId', a.org_id, 'eventId', a.event_id, 'ticketId', a.ticket_id, 'admissionId', a.id, 'day', a.day),
           a.admitted_at
    from checkin.admissions a join t9_tickets t on t.id = a.ticket_id;

    insert into platform.domain_events (id, org_id, type, version, aggregate_type, aggregate_id, payload, actor, request_id,
                                        replayed, created_at, updated_at)
    select id, org_id, type, 1, aggregate_type, aggregate_id, payload, 'legacy:' || {inst}, 'legacy-backfill:' || {run},
           true, at, at
    from t9_events
    on conflict (id) do nothing;

    -- Stamp them into the log the way the relay does (same lock, gap-free), already published.
    select pg_advisory_xact_lock(hashtext('platform.relay_stamp'));
    with base as (select coalesce(max(log_seq), 0) as b from platform.domain_events),
    pending as (
      select e.id, row_number() over (order by e.id) as rn
      from platform.domain_events e
      where e.replayed and e.log_seq is null and e.id in (select id from t9_events)
    )
    update platform.domain_events e set log_seq = base.b + pending.rn, published_at = now()
    from pending, base where e.id = pending.id;
  `,
  );
}
