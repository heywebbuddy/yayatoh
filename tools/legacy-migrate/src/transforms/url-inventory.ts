import { exec, hasColumn, hasTable, type Instance, type StepContext } from './context.ts';

/** The public host of each legacy instance (roadmap §7.7). */
export const LEGACY_HOSTS: Record<Instance, string> = { yay: 'yayatoh.com', abc: 'abc.yayatoh.com' };

/**
 * URL inventory (roadmap §7.7, V9; M2.2c): every DB-derived public URL of the legacy instance with
 * its planned status after cutover, in `legacy.url_inventory`:
 * - `/events/{slug}` and `/events/{slug}/attendee` (the seat finder on printed posters): 200 when the
 *   new slug is the same, 308 to the new slug when it changed, 404 for events that were not
 *   public (draft); a legacy slug shared by several events resolves as the legacy app did (the
 *   lowest id) and the others are listed;
 * - `/venues/{slug}`: 200 or 308 for directory venues, 404 for unlisted ones;
 * - `/{organisation_url}` (the organizer's root page): 308 to `/o/{slug}`.
 * Every 308 is loaded into `marketplace.legacy_redirects` for the instance host (and any extra
 * hosts, e.g. a dev host for e2e), served by the web proxy for at least 12 months.
 */
export async function urlInventory(ctx: StepContext, extraHosts: readonly string[] = []): Promise<void> {
  const hosts = [LEGACY_HOSTS[ctx.instance], ...extraHosts];
  await exec(
    ctx,
    `
    delete from legacy.url_inventory where instance = {inst};

    -- Events: the legacy slug resolves to the lowest id carrying it.
    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'url_ambiguous_slug', 'events', le.id::text, jsonb_build_object('slug', le.slug)
    from {s}.events le
    where exists (select 1 from {s}.events o where lower(btrim(o.slug)) = lower(btrim(le.slug)) and o.id < le.id);

    drop table if exists t_url_events;
    create temp table t_url_events as
    select distinct on (lower(btrim(le.slug))) lower(btrim(le.slug)) as legacy_slug, e.slug, e.org_id, e.status, e.visibility
    from {s}.events le
    join legacy.ref r on r.instance = {inst} and r.entity = 'events' and r.legacy_id = le.id::text
    join events.events e on e.id = r.new_id
    where btrim(coalesce(le.slug, '')) ~ '^[A-Za-z0-9._~-]+$'
    order by lower(btrim(le.slug)), le.id;
  `,
  );
  const venues = await hasTable(ctx, 'venues');
  const orgUrls = await hasColumn(ctx, 'users', 'organisation_url');
  for (const host of hosts) {
    const h = `'${host.replace(/'/g, "''")}'`;
    await exec(
      ctx,
      `
      insert into legacy.url_inventory (instance, host, path, kind, planned_status, target, org_id)
      select {inst}, ${h}, '/events/' || legacy_slug || x.suffix, 'event' || replace(x.suffix, '/', '_'),
             case when status <> 'published' then 404 when slug = legacy_slug then 200 else 308 end,
             case when status = 'published' and slug <> legacy_slug then '/events/' || slug || x.suffix end, org_id
      from t_url_events cross join (values (''), ('/attendee')) x(suffix)
      on conflict do nothing;
    `,
    );
    if (venues)
      await exec(
        ctx,
        `
        insert into legacy.url_inventory (instance, host, path, kind, planned_status, target, org_id)
        select {inst}, ${h}, '/venues/' || lower(btrim(lv.slug)), 'venue',
               case when not v.directory_listed then 404 when v.slug = lower(btrim(lv.slug)) then 200 else 308 end,
               case when v.directory_listed and v.slug <> lower(btrim(lv.slug)) then '/venues/' || v.slug end, v.org_id
        from {s}.venues lv
        join legacy.ref r on r.instance = {inst} and r.entity = 'venues' and r.legacy_id = lv.id::text
        join venues.venues v on v.id = r.new_id
        where btrim(coalesce(lv.slug, '')) ~ '^[A-Za-z0-9._~-]+$'
        on conflict do nothing;
      `,
      );
    if (orgUrls)
      await exec(
        ctx,
        `
        insert into legacy.url_inventory (instance, host, path, kind, planned_status, target, org_id)
        select {inst}, ${h}, '/' || lower(btrim(u.organisation_url)), 'organizer', 308, '/o/' || g.slug, g.id
        from {s}.users u
        join legacy.ref r on r.instance = {inst} and r.entity = 'organizers' and r.legacy_id = u.id::text
        join tenancy.organizations g on g.id = r.new_id
        where u.role_id = 3 and btrim(coalesce(u.organisation_url, '')) ~ '^[A-Za-z0-9._~-]+$'
          and lower(btrim(u.organisation_url)) not in ('events', 'venues', 'o', 'login', 'register', 'api', 'dashboard', 'admin')
        on conflict do nothing;
      `,
      );
  }
  await exec(
    ctx,
    `
    insert into marketplace.legacy_redirects (id, org_id, host, source, match, target, status)
    select legacy.det_uuid(null, {inst} || '|legacy_redirects|' || host || '|' || path), org_id, host, path, 'exact', target, 308
    from legacy.url_inventory where instance = {inst} and planned_status = 308 and org_id is not null
    on conflict (host, source) do update set target = excluded.target, status = excluded.status
      where marketplace.legacy_redirects.org_id = excluded.org_id;
  `,
  );
}
