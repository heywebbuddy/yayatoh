import { legacyTagPathSegment, urlSafeSegment } from '../content.ts';
import { exec, hasColumn, hasTable, type Instance, rows, type StepContext } from './context.ts';
import { platformOrg } from './t6-comms.ts';

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
 * - `/{organisation_url}` (the organizer's root page): 308 to `/o/{slug}`;
 * - (M2.2d) `/pages/{slug}` and `/blogs/{slug}` (Voyager pages and posts, as stored and in lower
 *   case): the host's own content (yay: the platform org, served when it is the marketplace content
 *   org; abc: ABC's tenant site) is 200 when the slug is unchanged, else 308 to the new slug; an
 *   organizer's content 308s to its organizer page (`/o/{org}/pages/{slug}`; from abc, on
 *   yayatoh.com); drafts are 404;
 * - (M2.2d) `/events/{slug}/tag_{Title}` (performer/speaker tag pages): 308 to the event's
 *   migrated speaker page, 404 when the event is not public.
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
  await contentUrls(ctx, hosts);
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

interface InventoryRow {
  instance: string;
  host: string;
  path: string;
  kind: string;
  planned_status: number;
  target: string | null;
  org_id: string;
  entity_id: string;
}

/** M2.2d: CMS pages and posts, and performer/speaker tag pages. */
async function contentUrls(ctx: StepContext, hosts: readonly string[]): Promise<void> {
  const inst = ctx.instance;
  const homeOrg = await platformOrg(ctx);
  const out: InventoryRow[] = [];
  const seen = new Set<string>();
  const add = (r: Omit<InventoryRow, 'instance'>) => {
    const key = `${r.host}|${r.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ instance: inst, ...r });
  };
  for (const [table, kind, base] of [
    ['pages', 'page', '/pages/'],
    ['posts', 'post', '/blogs/'],
  ] as const) {
    if (!(await hasTable(ctx, table))) continue;
    const entries = await rows<{
      legacy_slug: string;
      entry_id: string;
      slug: string;
      status: string;
      org_id: string;
      org_slug: string;
    }>(
      ctx,
      `select btrim(p.slug) as legacy_slug, e.id as entry_id, e.slug, e.status, e.org_id, o.slug as org_slug
       from {s}.${table} p
       join legacy.ref r on r.instance = {inst} and r.entity = '${table}' and r.legacy_id = p.id::text
       join cms.entries e on e.id = r.new_id
       join tenancy.organizations o on o.id = e.org_id
       order by p.id`,
    );
    for (const host of hosts)
      for (const e of entries) {
        const own = e.org_id === homeOrg;
        const target =
          e.status !== 'published'
            ? null
            : own
              ? `${base}${e.slug}`
              : `${inst === 'abc' ? `https://${LEGACY_HOSTS.yay}` : ''}/o/${e.org_slug}${base}${e.slug}`;
        for (const seg of new Set([e.legacy_slug, e.legacy_slug.toLowerCase()])) {
          if (!seg || !urlSafeSegment(seg)) continue;
          const path = `${base}${seg}`;
          add({
            host,
            path,
            kind,
            planned_status: target === null ? 404 : target === path ? 200 : 308,
            target: target === null || target === path ? null : target,
            org_id: e.org_id,
            entity_id: e.entry_id,
          });
        }
      }
  }
  if ((await hasTable(ctx, 'tags')) && (await hasTable(ctx, 'event_tag'))) {
    const tags = await rows<{
      event_slug: string;
      title: string;
      speaker_id: string;
      slug: string;
      status: string;
      org_id: string;
    }>(
      ctx,
      `select lower(btrim(le.slug)) as event_slug, btrim(t.title) as title, sp.id as speaker_id, e.slug, e.status, e.org_id
       from legacy.ref r
       join program.speakers sp on sp.id = r.new_id
       join events.events e on e.id = sp.event_id
       join {s}.tags t on t.id::text = split_part(r.legacy_id, ':', 1)
       join {s}.events le on le.id::text = split_part(r.legacy_id, ':', 2)
       where r.instance = {inst} and r.entity = 'event_tag' and btrim(coalesce(le.slug, '')) ~ '^[A-Za-z0-9._~-]+$'
       order by le.id, t.id`,
    );
    for (const host of hosts)
      for (const t of tags) {
        const seg = legacyTagPathSegment(t.title);
        if (!urlSafeSegment(seg)) continue;
        const published = t.status === 'published';
        add({
          host,
          path: `/events/${t.event_slug}/${seg}`,
          kind: 'tag',
          planned_status: published ? 308 : 404,
          target: published ? `/events/${t.slug}/speakers/${t.speaker_id}` : null,
          org_id: t.org_id,
          entity_id: t.speaker_id,
        });
      }
  }
  for (let i = 0; i < out.length; i += 1000)
    await ctx.sql`insert into legacy.url_inventory ${ctx.sql(out.slice(i, i + 1000))} on conflict do nothing`;
}
