import { detUuid, legacyKey, slugify } from '../ids.ts';
import { exec, hasTable, rows, type StepContext } from './context.ts';

/**
 * T3 Catalog, the part commerce needs (roadmap §7.5): events, ticket types, event roles and promo
 * codes. Venues directory, categories/tags, `event_series` inference and typed sub-entities (sessions,
 * speakers, sections) are Later.
 *
 * Time: the legacy app stored an event's DATE + TIME as wall-clock time in the platform timezone
 * (`regional.timezone_default`; the organizer's input was converted on save). The instant is that
 * wall clock at the platform zone (`--event-clock=platform`, the default; `venue` reads it as
 * venue-local instead, pending owner confirmation), and the event's IANA timezone (what it renders
 * in) comes from the venue's country and state. A repetitive event spans its first to last date.
 * Wall-clock times inside a DST fold or gap are logged. An event whose owner is not an organizer
 * (or no longer exists) goes to a per-instance holding org and the exceptions report: never dropped.
 */
export async function t3Catalog(ctx: StepContext): Promise<void> {
  const inst = ctx.instance;
  // Holding org for events whose owner has no org (created only when needed).
  const [orphans] = await rows<{ n: number }>(
    ctx,
    `select count(*)::int as n from {s}.events e
     where not exists (select 1 from legacy.ref o where o.instance = {inst} and o.entity = 'organizers' and o.legacy_id = e.user_id::text)`,
  );
  if ((orphans?.n ?? 0) > 0) {
    const id = detUuid(null, legacyKey(inst, 'organizers', 'unassigned'));
    await ctx.sql`
      insert into tenancy.organizations (id, org_id, slug, name, kind, status, timezone, currency, legacy_instance)
      values (${id}, ${id}, ${`legacy-${inst}-unassigned`}, ${`${inst.toUpperCase()} legacy events (unassigned)`},
              'organizer', 'limited', ${ctx.platformTz}, ${ctx.currency}, ${inst})
      on conflict (id) do nothing`;
    await ctx.sql`
      insert into legacy.ref (instance, entity, legacy_id, new_id, org_id)
      values (${inst}, 'organizers', 'unassigned', ${id}, ${id})
      on conflict (instance, entity, legacy_id) do nothing`;
  }

  await exec(
    ctx,
    `
    drop table if exists t3_events;
    create temp table t3_events as
    select e.id as legacy_id,
           coalesce(o.new_id, h.new_id) as org_id,
           o.new_id is null as orphan,
           coalesce(nullif(btrim(e.title), ''), 'Untitled event ' || e.id) as name,
           e.slug as legacy_slug,
           coalesce(vt.tz, vt2.tz, {tz}) as tz,
           (vt.tz is null and vt2.tz is null) as tz_fallback,
           (e.start_date + coalesce(e.start_time, '00:00'::time)) as start_wall,
           (coalesce(e.end_date, e.start_date) + coalesce(e.end_time, '23:59'::time)) as end_wall,
           case when upper(btrim(coalesce(e.currency, ''))) ~ '^[A-Z]{3}$' then upper(btrim(e.currency)) else {cur} end as currency,
           case when coalesce(e.publish, 0) = 1 and coalesce(e.status, 0) = 1 then 'published' else 'draft' end as status,
           case when coalesce(e.is_private, 0) = 1 then 'unlisted' else 'public' end as visibility,
           nullif(btrim(e.venue), '') as venue_name,
           nullif(btrim(e.city), '') as city,
           upper(c.country_code) as country,
           coalesce((e.created_at at time zone {tz}), (e.start_date::timestamp at time zone {tz})) as created,
           e.images, e.is_publishable, e.e_admin_commission, e.repetitive
    from {s}.events e
    left join legacy.ref o on o.instance = {inst} and o.entity = 'organizers' and o.legacy_id = e.user_id::text
    left join legacy.ref h on h.instance = {inst} and h.entity = 'organizers' and h.legacy_id = 'unassigned'
    left join {s}.countries c on c.id = e.country_id
    left join legacy.venue_tz vt on vt.country = coalesce(upper(c.country_code), '') and vt.state = upper(btrim(coalesce(e.state, '')))
    left join legacy.venue_tz vt2 on vt2.country = upper(c.country_code) and vt2.state = '*';

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'orphan_event_holding_org', 'events', legacy_id::text, jsonb_build_object('org_id', org_id)
    from t3_events where orphan;
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'event_timezone_fallback', 'events', legacy_id::text, jsonb_build_object('tz', tz)
    from t3_events where tz_fallback;
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'event_without_date', 'events', legacy_id::text, '{}'::jsonb
    from t3_events where start_wall is null;
  `,
  );

  // Instants: the stored wall clock at the platform zone (default) or at the venue zone.
  await exec(
    ctx,
    `
    alter table t3_events add column clock_tz text, add column starts_at timestamptz, add column ends_at timestamptz;
    update t3_events set clock_tz = case when {clock} = 'venue' then tz else {tz} end;
    update t3_events set starts_at = coalesce(start_wall at time zone clock_tz, created),
                         ends_at = end_wall at time zone clock_tz;
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'dst_' || k.kind, 'events', t.legacy_id::text,
           jsonb_build_object('wall', k.w, 'tz', t.clock_tz, 'field', k.field)
    from t3_events t
    cross join lateral (values ('start', t.start_wall), ('end', t.end_wall)) f(field, w)
    cross join lateral (select legacy.local_kind(f.w, t.clock_tz) as kind, f.w, f.field) k
    where f.w is not null and k.kind <> 'ok';
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'event_end_before_start', 'events', legacy_id::text,
           jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at)
    from t3_events where ends_at is null or ends_at <= starts_at;
    update t3_events set ends_at = starts_at + interval '3 hours' where ends_at is null or ends_at <= starts_at;

    -- JSON kept in text columns (content): quarantined when unparsable, the event still migrates.
    insert into legacy.quarantine (run_id, instance, table_name, legacy_id, column_name, reason, detail)
    select {run}, {inst}, 'events', legacy_id::text, 'images', 'invalid_json', left(images, 120)
    from t3_events where images is not null and legacy.try_jsonb(images) is null;
    insert into legacy.quarantine (run_id, instance, table_name, legacy_id, column_name, reason, detail)
    select {run}, {inst}, 'events', legacy_id::text, 'is_publishable', 'invalid_json', left(is_publishable, 120)
    from t3_events where is_publishable is not null and legacy.try_jsonb(is_publishable) is null;
    insert into legacy.quarantine (run_id, instance, table_name, legacy_id, column_name, reason, detail)
    select {run}, {inst}, 'users', u.id::text, 'social_links', 'invalid_json', left(u.social_links, 120)
    from {s}.users u where u.social_links is not null and legacy.try_jsonb(u.social_links) is null;
  `,
  );

  // Slugs (globally unique): the legacy slug when free, else `-{inst}-{id}`.
  const evs = await rows<{ legacy_id: string; legacy_slug: string | null; name: string; created: Date }>(
    ctx,
    `select legacy_id::text as legacy_id, legacy_slug, name, created from t3_events order by legacy_id`,
  );
  const taken = new Map(
    (await ctx.sql<{ slug: string; id: string }[]>`select slug, id from events.events`).map((r) => [
      r.slug,
      r.id,
    ]),
  );
  const slugOf = new Map([...taken.entries()].map(([slug, id]) => [id, slug]));
  const slugRows = evs.map((e) => {
    const id = detUuid(e.created, legacyKey(inst, 'events', e.legacy_id));
    const mine = slugOf.get(id);
    if (mine) return { legacy_id: e.legacy_id, id, slug: mine };
    let slug = slugify(e.legacy_slug || e.name, 60);
    if (taken.has(slug)) slug = `${slugify(e.legacy_slug || e.name, 48)}-${inst}-${e.legacy_id}`;
    taken.set(slug, id);
    return { legacy_id: e.legacy_id, id, slug };
  });
  await exec(
    ctx,
    `drop table if exists t3_slugs; create temp table t3_slugs (legacy_id bigint primary key, id uuid, slug text)`,
  );
  for (let i = 0; i < slugRows.length; i += 5000)
    await ctx.sql`insert into t3_slugs ${ctx.sql(slugRows.slice(i, i + 5000).map((r) => ({ ...r, legacy_id: Number(r.legacy_id) })))}`;

  await exec(
    ctx,
    `
    insert into events.events (id, org_id, slug, name, profile, status, visibility, timezone, starts_at, ends_at,
                               venue_name, city, country, currency, published_at, created_at, updated_at)
    select s.id, t.org_id, s.slug, left(t.name, 200), 'other', t.status, t.visibility, t.tz, t.starts_at, t.ends_at,
           t.venue_name, t.city, t.country, t.currency,
           case when t.status = 'published' then t.created end, t.created, t.created
    from t3_events t join t3_slugs s using (legacy_id)
    on conflict (id) do update
      set name = excluded.name, status = excluded.status, visibility = excluded.visibility,
          timezone = excluded.timezone, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
          venue_name = excluded.venue_name, city = excluded.city, country = excluded.country;

    insert into legacy.ref (instance, entity, legacy_id, new_id, org_id, compat_id)
    select {inst}, 'events', t.legacy_id::text, s.id, t.org_id, t.legacy_id
    from t3_events t join t3_slugs s using (legacy_id)
    on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id, org_id = excluded.org_id;
  `,
  );

  // Ticket types. Quantities are set after T4 (sold = migrated active tickets).
  await exec(
    ctx,
    `
    drop table if exists t3_tickets;
    create temp table t3_tickets as
    select t.id as legacy_id, ev.new_id as event_id, ev.org_id,
           legacy.det_uuid((t.created_at at time zone {tz}), {inst} || '|tickets|' || t.id) as id,
           left(coalesce(nullif(btrim(t.title), ''), 'Ticket'), 120) as name,
           nullif(btrim(t.description), '') as description,
           greatest(coalesce(round(t.price * 100), 0), 0)::bigint as price_minor,
           greatest(coalesce(t.quantity, 0), 0) as quantity,
           case when coalesce(t.status, 1) = 1 then 'public' else 'hidden' end as visibility,
           coalesce(t."order", 0) as sort_order,
           coalesce(t.is_donation, 0) = 1 as is_donation,
           greatest(1, least(coalesce(t.customer_limit, 10), 1000)) as max_per_order,
           t.sale_price, t.sale_end_date, t.access_dates,
           e2.currency,
           coalesce((t.created_at at time zone {tz}), now()) as created
    from {s}.tickets t
    join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = t.event_id::text
    join events.events e2 on e2.id = ev.new_id;

    insert into legacy.quarantine (run_id, instance, table_name, legacy_id, column_name, reason, detail)
    select {run}, {inst}, 'tickets', t.id::text, 'event_id', 'orphan', 'event ' || t.event_id || ' not found'
    from {s}.tickets t
    where not exists (select 1 from legacy.ref ev where ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = t.event_id::text);

    insert into ticketing.ticket_types (id, org_id, event_id, name, description, price_minor, currency, fee_mode,
                                        quantity_total, quantity_sold, quantity_held, min_per_order, max_per_order,
                                        visibility, sort_order, early_price_minor, early_ends_at, is_donation, access_dates,
                                        created_at, updated_at)
    select id, org_id, event_id, name, description, price_minor, currency, 'pass_on',
           quantity, 0, 0, 1, max_per_order, visibility, sort_order,
           case when not is_donation and sale_price is not null and sale_end_date is not null
                     and round(sale_price * 100) >= 0 and round(sale_price * 100) < price_minor
                then round(sale_price * 100)::bigint end,
           case when not is_donation and sale_price is not null and sale_end_date is not null
                     and round(sale_price * 100) >= 0 and round(sale_price * 100) < price_minor
                then (sale_end_date at time zone {tz}) end,
           is_donation,
           coalesce((select jsonb_agg(jsonb_build_object('date', d, 'name', d) order by d)
                     from jsonb_array_elements_text(case when jsonb_typeof(access_dates) = 'array' then access_dates else '[]'::jsonb end) d
                     where d ~ '^\\d{4}-\\d{2}-\\d{2}$'), '[]'::jsonb),
           created, created
    from t3_tickets
    on conflict (id) do nothing;

    insert into legacy.ref (instance, entity, legacy_id, new_id, org_id, compat_id)
    select {inst}, 'tickets', legacy_id::text, id, org_id, legacy_id from t3_tickets
    on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id, org_id = excluded.org_id;
  `,
  );

  // Event roles for sub-accounts assigned to specific events.
  if (await hasTable(ctx, 'user_roles'))
    await exec(
      ctx,
      `
      insert into events.event_role_assignments (id, org_id, event_id, user_id, role)
      select distinct on (ev.org_id, ev.new_id, u.new_id, r.role)
             legacy.det_uuid(null, 'event_role|' || ev.new_id || '|' || u.new_id || '|' || r.role),
             ev.org_id, ev.new_id, u.new_id, r.role
      from {s}.user_roles ur
      join (values (5, 'door_staff'), (6, 'event_manager')) r(role_id, role) on r.role_id = ur.role_id
      join legacy.ref u on u.instance = {inst} and u.entity = 'users' and u.legacy_id = ur.user_id::text
      join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = ur.event_id::text
      join tenancy.memberships m on m.org_id = ev.org_id and m.user_id = u.new_id
      where ur.event_id is not null
      on conflict (org_id, event_id, user_id, role) do nothing;
    `,
    );

  // Promo codes: legacy codes are organizer-wide and globally unique; the new ones are per event.
  // One code per (legacy code, event) its tickets link to or its bookings used.
  if (await hasTable(ctx, 'promocodes'))
    await exec(
      ctx,
      `
      drop table if exists t3_promos;
      create temp table t3_promos as
      with links as (
        select tp.promocode_id, t.event_id from {s}.ticket_promocode tp join {s}.tickets t on t.id = tp.ticket_id
        union
        select b.promocode_id, b.event_id from {s}.bookings b where b.promocode_id is not null
      ), cand as (
        select p.id as legacy_id, ev.new_id as event_id, ev.org_id, e2.currency,
               left(case when length(x.c) < 3 then rpad(x.c, 3, '0') else x.c end, 28) as base,
               p.p_type, p.reward, p.quantity, p.status, p.expires_at, p.created_at
        from {s}.promocodes p
        cross join lateral (select upper(regexp_replace(btrim(p.code), '[^A-Za-z0-9_-]+', '-', 'g')) as c) x
        join links l on l.promocode_id = p.id
        join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = l.event_id::text
        join events.events e2 on e2.id = ev.new_id
      )
      select c.*,
             legacy.det_uuid((c.created_at at time zone {tz}), {inst} || '|promocodes|' || c.legacy_id || '|' || c.event_id) as id,
             case when count(*) over (partition by c.event_id, c.base) > 1 then left(c.base, 24) || '-' || c.legacy_id else c.base end as code
      from cand c;

      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      select {run}, {inst}, 'promo_without_value', 'promocodes', legacy_id::text, jsonb_build_object('reward', reward)
      from t3_promos where coalesce(reward, 0) <= 0;

      insert into ticketing.promo_codes (id, org_id, event_id, code, kind, percent_bps, amount_minor, currency,
                                         ticket_type_ids, max_redemptions, redeemed_count, starts_at, ends_at, active, created_at)
      select p.id, p.org_id, p.event_id, p.code,
             case when p.p_type = 'percent' then 'percent' else 'amount' end,
             case when p.p_type = 'percent' then least(10000, greatest(1, round(p.reward * 100)))::int end,
             case when p.p_type <> 'percent' then round(p.reward * 100)::bigint end,
             p.currency,
             coalesce((select array_agg(tt.new_id order by tt.new_id) from {s}.ticket_promocode tp
                       join {s}.tickets t on t.id = tp.ticket_id
                       join legacy.ref tt on tt.instance = {inst} and tt.entity = 'tickets' and tt.legacy_id = tp.ticket_id::text
                       join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = t.event_id::text
                       where tp.promocode_id = p.legacy_id and ev.new_id = p.event_id), '{}'::uuid[]),
             case when coalesce(p.quantity, 0) > 0 then p.quantity end, 0, null,
             (p.expires_at at time zone {tz}),
             coalesce(p.status, 0) = 1,
             coalesce((p.created_at at time zone {tz}), now())
      from t3_promos p
      where coalesce(p.reward, 0) > 0
      on conflict (id) do nothing;

      insert into legacy.ref (instance, entity, legacy_id, new_id, org_id)
      select {inst}, 'promocodes', legacy_id || '|' || event_id, id, org_id from t3_promos where coalesce(reward, 0) > 0
      on conflict (instance, entity, legacy_id) do nothing;
    `,
    );
}
