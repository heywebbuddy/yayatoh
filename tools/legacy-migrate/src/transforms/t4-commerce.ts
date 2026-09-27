import { exec, type StepContext } from './context.ts';

/**
 * T4 Commerce (roadmap §7.5, audit-derived specifics).
 *
 * Orders. A legacy checkout writes one `bookings` row per person (quantity 1, its own
 * `order_number`, the QR payload) or one row per ticket type for "distribute later" (quantity N),
 * all sharing `common_order` (= `transactions.order_number`). So an order is the bookings of one
 * `(instance, common_order)` (and, defensively, one event and buyer). Hand-on rows
 * (`distributed_from_booking_id`) are not new tickets: they move one unit of their parent booking to
 * a new holder.
 *
 * Money, per booking row (major units ×100, exact): face = `price`, discount = `promocode_reward`,
 * fee (added on top) = `net_price − price + reward` (the "excluding" taxes), all-in = `net_price`,
 * organizer net = the commission row's `organiser_earning`. Order total = Σ net_price, fee = Σ fee,
 * subtotal = total − fee, discount = Σ reward. A row with quantity N that does not divide evenly
 * becomes two items (N−1 units at the floor and one unit carrying the remainder), so every total is
 * exact to the cent.
 *
 * Status: every row refunded (`booking_cancel = 3`) → refunded; some → partially_refunded; every row
 * cancelled (2 or 3) → cancelled; an unpaid offline row → awaiting_payment; else paid. Tickets are
 * void when their row was cancelled, disabled or never paid. Refunds become succeeded `refunds`.
 * Payments keep their `charge_model` (Stripe → legacy_platform, Stripe Direct →
 * legacy_direct_connected, PayPal → paypal, none/Offline → offline) and gateway reference; direct
 * charges are `organizer_mor` on the organizer's connected account.
 *
 * Attendees: one per ticket, from the legacy attendee rows (the email held in `address` when it is a
 * valid email, else the buyer's), each with an org contact. Commissions become one legacy statement
 * per org × event × currency and an opening balance per org × currency for what was still owed.
 *
 * Money and ticket rows that cannot be migrated exactly (an unknown event or ticket, a negative or
 * unparsable amount, a discount above the price, a hand-on without its parent) are quarantined, and
 * the run fails: these tables must quarantine zero rows.
 */
export async function t4Commerce(ctx: StepContext): Promise<void> {
  await exec(
    ctx,
    `
    drop table if exists t4_b;
    create temp table t4_b as
    select b.id as legacy_id, b.customer_id, b.event_id as legacy_event_id, b.ticket_id as legacy_ticket_id,
           coalesce(b.quantity, 0) as qty,
           round(b.price * 100)::bigint as p,
           round(coalesce(b.net_price, b.price + coalesce(b.tax, 0)) * 100)::bigint as n,
           case when nullif(btrim(b.promocode_reward), '') is null then 0 else legacy.to_minor(b.promocode_reward) end as r,
           b.promocode_reward as r_raw,
           coalesce(b.booking_cancel, 0) as cancel, coalesce(b.is_paid, 1) as is_paid, coalesce(b.status, 1) as status,
           nullif(b.transaction_id, 0) as transaction_id, b.common_order, b.order_number,
           b.distributed_from_booking_id as parent_legacy_id,
           b.customer_name, b.customer_email, b.promocode_id, b.ticket_title,
           coalesce((b.created_at at time zone {tz}), (b.updated_at at time zone {tz}), '2019-01-01 00:00:00+00') as created,
           coalesce((b.updated_at at time zone {tz}), (b.created_at at time zone {tz}), '2019-01-01 00:00:00+00') as updated,
           upper(btrim(b.currency)) as currency_raw,
           ev.new_id as event_id, ev.org_id, tt.new_id as ticket_type_id, tt.org_id as ticket_org_id
    from {s}.bookings b
    left join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = b.event_id::text
    left join legacy.ref tt on tt.instance = {inst} and tt.entity = 'tickets' and tt.legacy_id = b.ticket_id::text;
    create index on t4_b (legacy_id);
    create index on t4_b (parent_legacy_id);
    analyze t4_b;

    -- Money/ticket rows that cannot be migrated exactly: quarantined (the run then fails).
    drop table if exists t4_bad;
    create temp table t4_bad as
    select legacy_id, reason, detail from (
      select legacy_id, 'orphan_event' as reason, 'event ' || legacy_event_id as detail from t4_b where event_id is null
      union all select legacy_id, 'orphan_ticket', 'ticket ' || legacy_ticket_id from t4_b where event_id is not null and ticket_type_id is null
      union all select legacy_id, 'ticket_of_other_event', 'ticket ' || legacy_ticket_id from t4_b where ticket_org_id is not null and ticket_org_id <> org_id
      union all select legacy_id, 'invalid_quantity', qty::text from t4_b where qty < 1
      union all select legacy_id, 'invalid_amount', coalesce(p::text, 'null') || '/' || coalesce(n::text, 'null') from t4_b where p is null or n is null or p < 0 or n < 0
      union all select legacy_id, 'invalid_promocode_reward', r_raw from t4_b where r is null or r < 0
      union all select legacy_id, 'discount_above_price', r || ' > ' || p from t4_b where r > p
      union all select c.legacy_id, 'hand_on_without_parent', 'parent ' || c.parent_legacy_id from t4_b c
        where c.parent_legacy_id is not null and not exists (select 1 from t4_b p where p.legacy_id = c.parent_legacy_id and p.parent_legacy_id is null)
    ) x;
    insert into legacy.quarantine (run_id, instance, table_name, legacy_id, column_name, reason, detail)
    select {run}, {inst}, 'bookings', legacy_id::text, null, reason, detail from t4_bad;
    delete from t4_b b using t4_bad x where x.legacy_id = b.legacy_id;
    -- A hand-on of a quarantined parent goes with it.
    delete from t4_b c where c.parent_legacy_id is not null
      and not exists (select 1 from t4_b p where p.legacy_id = c.parent_legacy_id);

    alter table t4_b add column fee bigint, add column onet bigint, add column order_key text, add column order_id uuid;
    update t4_b set fee = greatest(0, n - p + r);
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'net_below_price', 'bookings', legacy_id::text, jsonb_build_object('price', p, 'net', n, 'reward', r)
    from t4_b where n - p + r < 0;
    update t4_b b set onet = coalesce(
      (select round(sum(c.organiser_earning) * 100)::bigint from {s}.commissions c where c.booking_id = b.legacy_id),
      b.n - b.fee);
    update t4_b set order_key = common_order || '|' || legacy_event_id || '|' || customer_id where parent_legacy_id is null;
    create index on t4_b (order_key);
  `,
  );

  // Orders.
  await exec(
    ctx,
    `
    drop table if exists t4_orders;
    create temp table t4_orders as
    with g as (
      select order_key, org_id, event_id,
             min(created) as created, max(updated) as updated,
             (array_agg(legacy_id order by legacy_id))[1] as first_row,
             (array_agg(transaction_id order by transaction_id) filter (where transaction_id is not null))[1] as transaction_id,
             (array_agg(promocode_id order by legacy_id) filter (where promocode_id is not null and r > 0))[1] as promocode_id,
             sum(n) as total, sum(fee) as fee, sum(r) as discount,
             sum(n) filter (where cancel = 3) as refunded,
             sum(fee) filter (where cancel = 3) as fee_refunded,
             bool_and(cancel = 3) as all_refunded, bool_or(cancel = 3 and n > 0) as any_refunded,
             bool_and(cancel in (2, 3)) as all_cancelled,
             bool_or(is_paid = 0 and cancel < 2) as unpaid, bool_or(is_paid = 1) as any_paid,
             max(currency_raw) filter (where currency_raw ~ '^[A-Z]{3}$') as currency_raw
      from t4_b where parent_legacy_id is null
      group by order_key, org_id, event_id
    )
    select g.*,
           legacy.det_uuid(g.created, {inst} || '|orders|' || g.order_key) as id,
           coalesce(g.currency_raw, e.currency) as currency,
           case when g.all_refunded and coalesce(g.refunded, 0) > 0 then 'refunded'
                when g.any_refunded then 'partially_refunded'
                when g.all_cancelled then 'cancelled'
                when g.unpaid then 'awaiting_payment'
                else 'paid' end as status,
           f.customer_id, f.customer_name, f.customer_email, e.timezone as event_tz
    from g join t4_b f on f.legacy_id = g.first_row
    join events.events e on e.id = g.event_id;
    create index on t4_orders (order_key);
    analyze t4_orders;
    update t4_b b set order_id = o.id from t4_orders o where o.order_key = b.order_key;

    -- Buyers: the booking's email when valid, else the account's, else a placeholder (listed).
    alter table t4_orders add column buyer_email text, add column buyer_name text, add column buyer_user_id uuid;
    update t4_orders o set
      buyer_email = coalesce(
        case when legacy.email_ok(legacy.email_norm(o.customer_email)) then legacy.email_norm(o.customer_email) end,
        (select legacy.email_norm(u.email) from {s}.users u where u.id = o.customer_id and legacy.email_ok(legacy.email_norm(u.email))),
        'buyer-' || {inst} || '-' || o.customer_id || '@legacy.invalid'),
      buyer_name = left(coalesce(nullif(btrim(o.customer_name), ''),
                                 (select nullif(btrim(u.name), '') from {s}.users u where u.id = o.customer_id), 'Guest'), 200),
      buyer_user_id = (select r.new_id from legacy.ref r where r.instance = {inst} and r.entity = 'users' and r.legacy_id = o.customer_id::text);
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'buyer_email_placeholder', 'bookings', first_row::text, jsonb_build_object('order_id', id)
    from t4_orders where buyer_email like '%@legacy.invalid';

    -- Payments: gateway, reference and charge model; direct charges on the connected account.
    alter table t4_orders add column gateway text, add column txn_id text, add column payer_ref text,
      add column charge_model text, add column provider text, add column funds_flow text, add column connected text;
    update t4_orders o set gateway = t.payment_gateway, txn_id = nullif(btrim(t.txn_id), ''), payer_ref = nullif(btrim(t.payer_reference), '')
    from {s}.transactions t where t.id = o.transaction_id;
    update t4_orders set charge_model = case
        when transaction_id is null or gateway is null or lower(gateway) = 'offline' then 'offline'
        when lower(gateway) = 'stripe direct' then 'legacy_direct_connected'
        when lower(gateway) = 'paypal' then 'paypal'
        else 'legacy_platform' end,
      provider = case
        when transaction_id is null or gateway is null or lower(gateway) = 'offline' then null
        when lower(gateway) in ('stripe', 'stripe direct') then 'stripe'
        else regexp_replace(lower(gateway), '[^a-z0-9]+', '_', 'g') end;
    update t4_orders o set funds_flow = 'organizer_mor', connected = a.account_id
    from payments.payment_accounts a
    where a.org_id = o.org_id and o.charge_model = 'legacy_direct_connected';
    update t4_orders set funds_flow = 'platform_mor' where funds_flow is null;
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'direct_charge_without_account', 'bookings', first_row::text, jsonb_build_object('order_id', id)
    from t4_orders where charge_model = 'legacy_direct_connected' and connected is null;
    -- The gateway reference is unique per org and provider; a repeated one (the legacy app only
    -- deduplicated in code) is kept as the payment reference and listed.
    alter table t4_orders add column dup_txn boolean;
    update t4_orders o set dup_txn = x.rn > 1
    from (select id, row_number() over (partition by org_id, provider, txn_id order by created, id) as rn from t4_orders where txn_id is not null) x
    where x.id = o.id;
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'duplicate_gateway_reference', 'transactions', transaction_id::text, jsonb_build_object('order_id', id)
    from t4_orders where dup_txn;
  `,
  );

  // Contacts (per org, by normalized email): buyers and ticket holders.
  await exec(
    ctx,
    `
    -- Ticket units: one per quantity of each (non hand-on) row.
    drop table if exists t4_units;
    create temp table t4_units as
    select b.legacy_id, u, b.qty, b.org_id, b.event_id, b.ticket_type_id, b.order_id, b.created, b.updated,
           b.cancel, b.is_paid, b.status as bstatus,
           legacy.det_uuid(b.created, {inst} || '|booking_units|' || b.legacy_id || ':' || u) as ticket_id,
           legacy.det_uuid(b.created, {inst} || '|attendees|' || b.legacy_id || ':' || u) as attendee_id
    from t4_b b cross join lateral generate_series(1, b.qty) u
    where b.parent_legacy_id is null;
    create index on t4_units (legacy_id, u);
    analyze t4_units;

    -- Holders: a hand-on takes a unit from the end; the row's own attendees fill from the start.
    alter table t4_units add column holder_name text, add column holder_email text, add column hand_on_legacy_id bigint;
    with kids as (
      select c.parent_legacy_id as legacy_id, c.legacy_id as child_id, c.customer_name, c.customer_email, c.customer_id,
             row_number() over (partition by c.parent_legacy_id order by c.legacy_id) as k
      from t4_b c where c.parent_legacy_id is not null
    )
    update t4_units t set hand_on_legacy_id = k.child_id,
      holder_name = coalesce(nullif(btrim(k.customer_name), ''), 'Guest'),
      holder_email = case when legacy.email_ok(legacy.email_norm(k.customer_email)) then legacy.email_norm(k.customer_email) end
    from kids k where k.legacy_id = t.legacy_id and t.u = t.qty - k.k + 1;
    with att as (
      select a.booking_id as legacy_id, a.name, legacy.email_norm(a.address) as email,
             row_number() over (partition by a.booking_id order by a.id) as rn
      from (select distinct on (booking_id, lower(coalesce(address, '')), coalesce(name, '')) * from {s}.attendees
            where booking_id is not null order by booking_id, lower(coalesce(address, '')), coalesce(name, ''), id) a
    )
    update t4_units t set holder_name = coalesce(nullif(btrim(a.name), ''), t.holder_name),
      holder_email = case when legacy.email_ok(a.email) then a.email end
    from att a where a.legacy_id = t.legacy_id and a.rn = t.u and t.hand_on_legacy_id is null;
    update t4_units t set holder_name = left(coalesce(nullif(btrim(t.holder_name), ''), o.buyer_name), 200),
                          holder_email = coalesce(t.holder_email, o.buyer_email)
    from t4_orders o where o.id = t.order_id;

    insert into crm.contacts (id, org_id, email, email_norm, name, user_id, source, created_at, updated_at)
    select distinct on (org_id, email)
           legacy.det_uuid(created, {inst} || '|contacts|' || org_id || '|' || email), org_id, email, email, name,
           (select u.id from auth.users u where u.email = x.email), 'legacy', created, created
    from (
      select org_id, buyer_email as email, buyer_name as name, created from t4_orders
      union all select org_id, holder_email, holder_name, created from t4_units
    ) x
    order by org_id, email, created
    on conflict (org_id, email_norm) do nothing;
  `,
  );

  await exec(
    ctx,
    `
    insert into orders.orders (id, org_id, event_id, status, buyer_email, buyer_name, buyer_user_id, buyer_contact_id, locale,
                               currency, subtotal_minor, discount_minor, promo_code_id, promo_code, fee_minor, total_minor,
                               funds_flow, connected_account_id, fee_schedule, provider, provider_payment_id,
                               manage_token_hash, created_via, collected_by, payment_method, payment_reference, charge_model,
                               paid_at, cancelled_at, created_at, updated_at)
    select o.id, o.org_id, o.event_id, o.status, o.buyer_email, o.buyer_name, o.buyer_user_id,
           (select c.id from crm.contacts c where c.org_id = o.org_id and c.email_norm = o.buyer_email),
           'en', o.currency, o.total - o.fee, o.discount, pc.id, pc.code, o.fee, o.total,
           o.funds_flow, o.connected,
           jsonb_build_object('percentBps', coalesce(round(ev.e_admin_commission * 100)::int,
                                                     (select commission_bps from legacy.instance_settings where instance = {inst})),
                              'fixedMinor', 0, 'source', 'legacy:' || {inst}),
           o.provider, case when o.dup_txn then null else o.txn_id end,
           'legacy-unissued:' || o.id, 'legacy',
           case when o.charge_model = 'offline' then 'organizer' else 'platform' end,
           case when o.charge_model = 'offline' and o.total > 0 then 'other' end,
           coalesce(o.payer_ref, o.txn_id), o.charge_model,
           case when o.any_paid and o.status <> 'awaiting_payment' then o.created end,
           case when o.status in ('cancelled', 'refunded') then o.updated end,
           o.created, o.updated
    from t4_orders o
    join legacy.ref er on er.new_id = o.event_id and er.instance = {inst} and er.entity = 'events'
    join {s}.events ev on ev.id::text = er.legacy_id
    left join legacy.ref pr on pr.instance = {inst} and pr.entity = 'promocodes' and pr.legacy_id = o.promocode_id || '|' || o.event_id
    left join ticketing.promo_codes pc on pc.id = pr.new_id
    on conflict (id) do nothing;

    insert into legacy.ref (instance, entity, legacy_id, new_id, org_id)
    select {inst}, 'orders', order_key, id, org_id from t4_orders
    on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id;
  `,
  );

  // Order items: each row split into at most two exact parts, then grouped per identical units.
  await exec(
    ctx,
    `
    drop table if exists t4_parts;
    create temp table t4_parts as
    with base as (
      select b.*, (b.p / b.qty) as pf, (b.r / b.qty) as rf, (b.fee / b.qty) as ff, (b.n / b.qty) as nf, (b.onet / b.qty) as of_
      from t4_b b where b.parent_legacy_id is null
    ), even as (
      select *, (p = pf * qty and r = rf * qty and fee = ff * qty and n = nf * qty and onet = of_ * qty) as divides from base
    )
    select legacy_id, order_id, org_id, ticket_type_id, ticket_title, created, 1 as part,
           case when divides then qty else qty - 1 end as quantity, pf as face, rf as disc, ff as fee, nf as allin, of_ as onet
    from even where divides or qty > 1
    union all
    select legacy_id, order_id, org_id, ticket_type_id, ticket_title, created, 2,
           1, p - pf * (qty - 1), r - rf * (qty - 1), fee - ff * (qty - 1), n - nf * (qty - 1), onet - of_ * (qty - 1)
    from even where not divides;
    create index on t4_parts (legacy_id, part);
    analyze t4_parts;

    drop table if exists t4_items;
    create temp table t4_items as
    select order_id, org_id, ticket_type_id, face, disc, fee, allin, onet,
           min(created) as created, sum(quantity) as quantity,
           left(coalesce(nullif(btrim(min(ticket_title)), ''), (select name from ticketing.ticket_types where id = ticket_type_id)), 120) as name,
           legacy.det_uuid(min(created), {inst} || '|order_items|' || min(legacy_id) || ':' || min(part)) as id
    from t4_parts
    group by order_id, org_id, ticket_type_id, face, disc, fee, allin, onet;
    create index on t4_items (order_id, ticket_type_id, face, disc, fee, allin, onet);
    analyze t4_items;

    insert into orders.order_items (id, org_id, order_id, ticket_type_id, name, quantity, unit_face_minor, unit_discount_minor,
                                    unit_fee_minor, unit_all_in_minor, unit_organizer_net_minor, created_at, updated_at)
    select id, org_id, order_id, ticket_type_id, name, quantity, face, least(disc, face), fee, allin, onet, created, created
    from t4_items
    on conflict (id) do nothing;

    -- A row's last unit goes to its remainder part (part 2) when the row was split.
    alter table t4_units add column order_item_id uuid, add column part int;
    update t4_units t set part = 2 from t4_parts p2 where p2.legacy_id = t.legacy_id and p2.part = 2 and t.u = t.qty;
    update t4_units set part = 1 where part is null;
    update t4_units t set order_item_id = i.id
    from t4_parts pt, t4_items i
    where pt.legacy_id = t.legacy_id and pt.part = t.part
      and i.order_id = pt.order_id and i.ticket_type_id = pt.ticket_type_id and i.face = pt.face and i.disc = pt.disc
      and i.fee = pt.fee and i.allin = pt.allin and i.onet = pt.onet;
    create index on t4_units (order_id);
  `,
  );

  // Attendees and tickets.
  await exec(
    ctx,
    `
    alter table t4_units add column status text, add column void_reason text, add column serial int, add column contact_id uuid;
    update t4_units set status = case when cancel >= 2 or bstatus = 0 or is_paid = 0 then 'void' else 'active' end,
                        void_reason = case when cancel = 3 then 'refunded' when cancel = 2 then 'cancelled'
                                           when bstatus = 0 then 'disabled' when is_paid = 0 then 'unpaid' end;
    update t4_units t set serial = x.serial
    from (select legacy_id, u, row_number() over (partition by event_id order by created, legacy_id, u) as serial from t4_units) x
    where x.legacy_id = t.legacy_id and x.u = t.u;
    update t4_units t set contact_id = c.id from crm.contacts c where c.org_id = t.org_id and c.email_norm = t.holder_email;

    insert into attendees.attendees (id, org_id, event_id, contact_id, source, ticket_id, name, email, status, created_at, updated_at)
    select attendee_id, org_id, event_id, contact_id, 'ticket', ticket_id, holder_name, holder_email,
           case when status = 'active' then 'active' else 'cancelled' end, created, updated
    from t4_units
    on conflict (id) do nothing;

    -- Short codes derive from the ticket id; a collision within the org takes the next salt.
    alter table t4_units add column short_code text, add column salt int default 0;
    update t4_units set short_code = legacy.short_code(ticket_id, 0);
  `,
  );
  for (let salt = 1; salt < 8; salt++) {
    const clashes = await exec(
      ctx,
      `
      update t4_units t set salt = ${salt}, short_code = legacy.short_code(t.ticket_id, ${salt})
      where t.ctid in (
        select ctid from (
          select ctid, row_number() over (partition by org_id, short_code order by ticket_id) as rn from t4_units
        ) x where x.rn > 1
      ) or exists (select 1 from ticketing.tickets k where k.org_id = t.org_id and k.short_code = t.short_code and k.id <> t.ticket_id);
    `,
    );
    if (clashes === 0) break;
  }

  await exec(
    ctx,
    `
    insert into ticketing.tickets (id, org_id, event_id, ticket_type_id, order_id, order_item_id, serial, short_code,
                                   status, void_reason, rev, holder_name, holder_email, attendee_id, created_at, updated_at)
    select ticket_id, org_id, event_id, ticket_type_id, order_id, order_item_id, serial, short_code,
           status, void_reason, 0, holder_name, holder_email, attendee_id, created, updated
    from t4_units
    on conflict (id) do nothing;

    -- compat ids: a booking row's first ticket carries the legacy booking id; every unit and every
    -- hand-on row is mapped too.
    insert into legacy.ref (instance, entity, legacy_id, new_id, org_id, compat_id)
    select {inst}, 'bookings', legacy_id::text, ticket_id, org_id, legacy_id from t4_units where u = 1
    union all
    select {inst}, 'booking_units', legacy_id || ':' || u, ticket_id, org_id, null from t4_units
    union all
    select {inst}, 'bookings', hand_on_legacy_id::text, ticket_id, org_id, hand_on_legacy_id from t4_units where hand_on_legacy_id is not null
    on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id, org_id = excluded.org_id;

    analyze legacy.ref;

    -- Refunds (succeeded; the money already went back in the legacy app).
    insert into orders.refunds (id, org_id, order_id, status, reason, amount_minor, fee_refunded_minor, currency, ticket_ids,
                                requested_by, completed_at, created_at, updated_at)
    select legacy.det_uuid(o.updated, {inst} || '|refunds|' || o.order_key), o.org_id, o.id, 'succeeded', 'requested_by_customer',
           o.refunded, least(coalesce(o.fee_refunded, 0), o.refunded), o.currency,
           coalesce(rt.ticket_ids, '{}'::uuid[]),
           'legacy:' || {inst}, o.updated, o.updated, o.updated
    from t4_orders o
    left join (select t.order_id, array_agg(t.ticket_id order by t.serial) as ticket_ids
               from t4_units t where t.cancel = 3 group by t.order_id) rt on rt.order_id = o.id
    where coalesce(o.refunded, 0) > 0
    on conflict (id) do nothing;

    -- Inventory: sold = migrated active tickets (capacity raised if the legacy data oversold).
    update ticketing.ticket_types tt set quantity_sold = x.sold, quantity_total = greatest(tt.quantity_total, x.sold)
    from (select ticket_type_id, count(*) filter (where status = 'active') as sold from t4_units group by ticket_type_id) x
    where tt.id = x.ticket_type_id;

    -- Promo redemptions carry over.
    update ticketing.promo_codes pc set redeemed_count = x.n,
      max_redemptions = case when pc.max_redemptions is null then null else greatest(pc.max_redemptions, x.n) end
    from (select promo_code_id, count(*)::int as n from orders.orders where promo_code_id is not null and created_via = 'legacy'
          group by promo_code_id) x
    where pc.id = x.promo_code_id;
  `,
  );

  // Legacy settlements (commissions).
  await exec(
    ctx,
    `
    drop table if exists t4_comm;
    create temp table t4_comm as
    select c.id as legacy_id, c.booking_id, b.org_id, b.event_id,
           coalesce(o.currency, e.currency) as currency,
           round(c.customer_paid * 100)::bigint as paid, round(c.admin_commission * 100)::bigint as commission,
           round(coalesce(c.admin_tax, 0) * 100)::bigint as admin_tax, round(c.organiser_earning * 100)::bigint as earning,
           coalesce(c.status, 0) as status, coalesce(c.transferred, 0) as transferred, coalesce(c.settled, 0) as settled
    from {s}.commissions c
    left join t4_b b on b.legacy_id = c.booking_id
    left join t4_orders o on o.id = b.order_id
    left join events.events e on e.id = b.event_id;

    insert into legacy.quarantine (run_id, instance, table_name, legacy_id, column_name, reason, detail)
    select {run}, {inst}, 'commissions', legacy_id::text, 'booking_id', 'orphan', 'booking ' || coalesce(booking_id::text, 'null')
    from t4_comm where org_id is null and not exists (select 1 from t4_bad x where x.legacy_id = t4_comm.booking_id);
    delete from t4_comm where org_id is null;

    insert into payments.legacy_settlements (id, org_id, kind, instance, event_id, currency, status, customer_paid_minor,
                                             commission_minor, admin_tax_minor, organizer_earning_minor, transferred_minor,
                                             open_minor, clawback_minor, source_rows)
    select legacy.det_uuid(null, {inst} || '|legacy_settlements|event|' || event_id || '|' || currency), org_id, 'event_statement',
           {inst}, event_id, currency,
           case when coalesce(sum(earning) filter (where status = 1 and transferred = 0), 0) > 0 then 'open' else 'settled' end,
           coalesce(sum(paid) filter (where status = 1), 0), coalesce(sum(commission) filter (where status = 1), 0),
           coalesce(sum(admin_tax) filter (where status = 1), 0), coalesce(sum(earning) filter (where status = 1), 0),
           coalesce(sum(earning) filter (where status = 1 and transferred = 1), 0),
           coalesce(sum(earning) filter (where status = 1 and transferred = 0), 0),
           coalesce(sum(earning) filter (where status = 0 and transferred = 1 and settled = 0), 0),
           count(*)
    from t4_comm group by org_id, event_id, currency
    on conflict (id) do update set status = excluded.status, customer_paid_minor = excluded.customer_paid_minor,
      commission_minor = excluded.commission_minor, admin_tax_minor = excluded.admin_tax_minor,
      organizer_earning_minor = excluded.organizer_earning_minor, transferred_minor = excluded.transferred_minor,
      open_minor = excluded.open_minor, clawback_minor = excluded.clawback_minor, source_rows = excluded.source_rows
    where payments.legacy_settlements.status <> 'signed_off';

    -- Unsettled amounts: owner-signed opening balances, never released without that sign-off.
    insert into payments.legacy_settlements (id, org_id, kind, instance, event_id, currency, status, customer_paid_minor,
                                             commission_minor, admin_tax_minor, organizer_earning_minor, transferred_minor,
                                             open_minor, clawback_minor, source_rows)
    select legacy.det_uuid(null, {inst} || '|legacy_settlements|opening|' || org_id || '|' || currency), org_id, 'opening_balance',
           {inst}, null, currency, 'pending_signoff',
           sum(paid) filter (where status = 1 and transferred = 0), sum(commission) filter (where status = 1 and transferred = 0),
           coalesce(sum(admin_tax) filter (where status = 1 and transferred = 0), 0),
           sum(earning) filter (where status = 1 and transferred = 0), 0,
           sum(earning) filter (where status = 1 and transferred = 0),
           coalesce(sum(earning) filter (where status = 0 and transferred = 1 and settled = 0), 0),
           count(*) filter (where status = 1 and transferred = 0)
    from t4_comm group by org_id, currency
    having coalesce(sum(earning) filter (where status = 1 and transferred = 0), 0) > 0
    on conflict (id) do update set customer_paid_minor = excluded.customer_paid_minor, commission_minor = excluded.commission_minor,
      admin_tax_minor = excluded.admin_tax_minor, organizer_earning_minor = excluded.organizer_earning_minor,
      open_minor = excluded.open_minor, clawback_minor = excluded.clawback_minor, source_rows = excluded.source_rows
    where payments.legacy_settlements.status = 'pending_signoff';
  `,
  );
}
