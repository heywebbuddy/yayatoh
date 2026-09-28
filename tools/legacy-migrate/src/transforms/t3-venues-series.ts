import { mapCategory, seriesKey, seriesName } from '../categories.ts';
import { detUuid, legacyKey, slugify } from '../ids.ts';
import { exec, hasTable, rows, type StepContext } from './context.ts';

/**
 * T3 remainder (M2.2c): the legacy venues directory, categories and series inference.
 *
 * - **Venues.** Each `venues` row becomes its organizer's org venue (listed in the platform
 *   directory when it was active). Slug: the legacy one when free, else `-{inst}-{id}`. Country
 *   from `country_id`, timezone from the country and state (platform zone fallback, listed),
 *   coordinates when both parse and are in range (else none, listed). Events linked through
 *   `event_venue` point at it (`events.venue_id`). A venue whose owner is not an organizer is
 *   listed and not migrated; inline event venues stay the event's display text.
 * - **Categories.** yayatoh.com categories map to the platform taxonomy (`src/categories.ts`);
 *   abc categories become an org tag with the legacy name plus the mapped category. Unmapped
 *   categories become `other` and are listed. An event keeps a category set after migration.
 * - **Series.** Events of one org whose titles match without the year (`seriesKey`) across two or
 *   more years become an `events.series` (owner review: exception `series_inferred`; editable in
 *   the console). An event already in a series is left alone.
 */
export async function t3VenuesSeries(ctx: StepContext): Promise<void> {
  const inst = ctx.instance;

  if (await hasTable(ctx, 'venues')) {
    const legacy = await rows<{
      id: string;
      title: string;
      slug: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zipcode: string | null;
      glat: string | null;
      glong: string | null;
      status: number | null;
      country: string | null;
      org_id: string | null;
      tz: string | null;
      created: Date | null;
    }>(
      ctx,
      `select v.id::text as id, v.title, v.slug, v.address, v.city, v.state, v.zipcode, v.glat, v.glong, v.status,
              upper(c.country_code) as country, o.org_id,
              coalesce(vt.tz, vt2.tz) as tz, (v.created_at at time zone {tz}) as created
       from {s}.venues v
       left join {s}.countries c on c.id = v.country_id
       left join legacy.ref o on o.instance = {inst} and o.entity = 'organizers' and o.legacy_id = v.organizer_id::text
       left join legacy.venue_tz vt on vt.country = coalesce(upper(c.country_code), 'US') and vt.state = upper(btrim(coalesce(v.state, '')))
       left join legacy.venue_tz vt2 on vt2.country = coalesce(upper(c.country_code), 'US') and vt2.state = '*'
       order by v.id`,
    );
    const taken = new Map(
      (await ctx.sql<{ slug: string; id: string }[]>`select slug, id from venues.venues`).map((r) => [
        r.slug,
        r.id,
      ]),
    );
    const out: Record<string, unknown>[] = [];
    const exceptions: Record<string, unknown>[] = [];
    const num = (t: string | null, lo: number, hi: number) => {
      const n = t === null || t.trim() === '' ? Number.NaN : Number(t);
      return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
    };
    for (const v of legacy) {
      if (!v.org_id) {
        exceptions.push({ kind: 'venue_without_organizer', legacy_id: v.id, detail: {} });
        continue;
      }
      const id = detUuid(v.created, legacyKey(inst, 'venues', v.id));
      let slug = [...taken.entries()].find(([, vid]) => vid === id)?.[0];
      if (!slug) {
        slug = slugify(v.slug || v.title, 60);
        if (taken.has(slug)) slug = `${slugify(v.slug || v.title, 48)}-${inst}-${v.id}`;
        taken.set(slug, id);
      }
      const lat = num(v.glat, -90, 90);
      const lng = num(v.glong, -180, 180);
      if ((lat === null || lng === null) && (v.glat?.trim() || v.glong?.trim()))
        exceptions.push({
          kind: 'venue_coordinates_invalid',
          legacy_id: v.id,
          detail: { glat: v.glat, glong: v.glong },
        });
      if (!v.tz)
        exceptions.push({ kind: 'venue_timezone_fallback', legacy_id: v.id, detail: { tz: ctx.platformTz } });
      if (!v.country)
        exceptions.push({ kind: 'venue_country_fallback', legacy_id: v.id, detail: { country: 'US' } });
      out.push({
        id,
        org_id: v.org_id,
        slug,
        name: (v.title?.trim() || `Venue ${v.id}`).slice(0, 200),
        address_line1: v.address?.trim() || null,
        city: v.city?.trim() || null,
        region: v.state?.trim() || null,
        postal_code: v.zipcode?.trim() || null,
        country: v.country && /^[A-Z]{2}$/.test(v.country) ? v.country : 'US',
        latitude: lat !== null && lng !== null ? lat : null,
        longitude: lat !== null && lng !== null ? lng : null,
        timezone: v.tz ?? ctx.platformTz,
        directory_listed: Number(v.status) === 1,
        created_at: v.created ?? '1970-01-01T00:00:00Z',
        updated_at: v.created ?? '1970-01-01T00:00:00Z',
        legacy_id: v.id,
      });
    }
    for (let i = 0; i < out.length; i += 2000) {
      const batch = out.slice(i, i + 2000);
      await ctx.sql`
        insert into venues.venues ${ctx.sql(
          batch.map(({ legacy_id: _, ...r }) => r),
          'id',
          'org_id',
          'slug',
          'name',
          'address_line1',
          'city',
          'region',
          'postal_code',
          'country',
          'latitude',
          'longitude',
          'timezone',
          'directory_listed',
          'created_at',
          'updated_at',
        )}
        on conflict (id) do update set name = excluded.name, address_line1 = excluded.address_line1,
          city = excluded.city, region = excluded.region, postal_code = excluded.postal_code,
          country = excluded.country, latitude = excluded.latitude, longitude = excluded.longitude,
          timezone = excluded.timezone, directory_listed = excluded.directory_listed`;
      await ctx.sql`
        insert into legacy.ref ${ctx.sql(
          batch.map((r) => ({
            instance: inst,
            entity: 'venues',
            legacy_id: r.legacy_id as string,
            new_id: r.id as string,
            org_id: r.org_id as string,
            compat_id: Number(r.legacy_id),
          })),
        )}
        on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id, org_id = excluded.org_id`;
    }
    if (exceptions.length)
      await ctx.sql`insert into legacy.exceptions ${ctx.sql(
        exceptions.map((e) => ({
          run_id: ctx.runId,
          instance: inst,
          kind: e.kind as string,
          legacy_table: 'venues',
          legacy_id: e.legacy_id as string,
          detail: JSON.stringify(e.detail),
        })),
      )}`;
    if (await hasTable(ctx, 'event_venue'))
      await exec(
        ctx,
        `
        insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
        select {run}, {inst}, 'event_venue_other_org', 'event_venue', ev.legacy_id,
               jsonb_build_object('venue', vr.legacy_id)
        from (select distinct on (event_id) * from {s}.event_venue order by event_id, venue_id) l
        join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = l.event_id::text
        join legacy.ref vr on vr.instance = {inst} and vr.entity = 'venues' and vr.legacy_id = l.venue_id::text
        where vr.org_id <> ev.org_id;

        update events.events e set venue_id = vr.new_id
        from (select distinct on (event_id) * from {s}.event_venue order by event_id, venue_id) l
        join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = l.event_id::text
        join legacy.ref vr on vr.instance = {inst} and vr.entity = 'venues' and vr.legacy_id = l.venue_id::text
        where e.id = ev.new_id and vr.org_id = ev.org_id and e.venue_id is distinct from vr.new_id;
      `,
      );
  }

  // Categories.
  if (await hasTable(ctx, 'categories')) {
    const cats = await rows<{ id: string; name: string; slug: string | null }>(
      ctx,
      `select id::text as id, coalesce(name, '') as name, slug from {s}.categories order by id`,
    );
    const mapped = cats.map((c) => ({ ...c, ...mapCategory(c.name, c.slug) }));
    await exec(
      ctx,
      `drop table if exists t3_categories;
       create temp table t3_categories (legacy_id bigint primary key, name text, category text, matched boolean)`,
    );
    if (mapped.length)
      await ctx.sql`insert into t3_categories ${ctx.sql(
        mapped.map((m) => ({
          legacy_id: Number(m.id),
          name: m.name.trim().replace(/\s+/g, ' ').slice(0, 40),
          category: m.category,
          matched: m.matched,
        })),
      )}`;
    await exec(
      ctx,
      `
      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      select {run}, {inst}, 'category_unmapped', 'categories', legacy_id::text, jsonb_build_object('name', name)
      from t3_categories where not matched;

      update events.events e set category = c.category
      from {s}.events le
      join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = le.id::text
      join t3_categories c on c.legacy_id = le.category_id
      where e.id = ev.new_id and e.category is null;
    `,
    );
    if (inst === 'abc')
      await exec(
        ctx,
        `
        insert into events.event_tags (id, org_id, event_id, tag, tag_key)
        select legacy.det_uuid(null, {inst} || '|event_tags|' || le.id || '|' || c.legacy_id), ev.org_id, ev.new_id,
               c.name, lower(c.name)
        from {s}.events le
        join legacy.ref ev on ev.instance = {inst} and ev.entity = 'events' and ev.legacy_id = le.id::text
        join t3_categories c on c.legacy_id = le.category_id
        where c.name <> ''
        on conflict (org_id, event_id, tag_key) do nothing;
      `,
      );
  }

  // Series inference.
  const evs = await rows<{
    id: string;
    org_id: string;
    name: string;
    year: number;
    starts_at: Date;
    in_series: boolean;
  }>(
    ctx,
    `select e.id, e.org_id, e.name, extract(year from e.starts_at at time zone e.timezone)::int as year, e.starts_at,
            exists (select 1 from events.series_events se where se.org_id = e.org_id and se.event_id = e.id) as in_series
     from legacy.ref r join events.events e on e.id = r.new_id
     where r.instance = {inst} and r.entity = 'events'
     order by e.starts_at, e.id`,
  );
  const groups = new Map<string, typeof evs>();
  for (const e of evs) {
    const k = seriesKey(e.name);
    if (k.length < 2) continue;
    const key = `${e.org_id}|${k}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const takenSeries = new Map(
    (await ctx.sql<{ slug: string; id: string }[]>`select slug, id from events.series`).map((r) => [
      r.slug,
      r.id,
    ]),
  );
  for (const [key, members] of groups) {
    if (new Set(members.map((m) => m.year)).size < 2) continue;
    const [orgId, k] = key.split('|') as [string, string];
    const latest = members[members.length - 1] as (typeof members)[number];
    const id = detUuid(null, legacyKey(inst, 'series', key));
    let slug = [...takenSeries.entries()].find(([, sid]) => sid === id)?.[0];
    if (!slug) {
      slug = slugify(k, 60);
      if (slug.length < 2 || takenSeries.has(slug)) slug = `${slugify(k, 44)}-${inst}-${id.slice(-6)}`;
      takenSeries.set(slug, id);
    }
    const name = seriesName(latest.name);
    await ctx.sql`
      insert into events.series (id, org_id, slug, name, created_at, updated_at)
      values (${id}, ${orgId}, ${slug}, ${name.length >= 2 ? name : `Series ${slug}`}, ${members[0]?.starts_at ?? null}, ${members[0]?.starts_at ?? null})
      on conflict (id) do nothing`;
    const joining = members.filter((m) => !m.in_series);
    if (joining.length)
      await ctx.sql`
        insert into events.series_events ${ctx.sql(
          joining.map((m) => ({
            id: detUuid(null, legacyKey(inst, 'series_events', m.id)),
            org_id: orgId,
            series_id: id,
            event_id: m.id,
          })),
        )}
        on conflict (org_id, event_id) do nothing`;
    await ctx.sql`
      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      values (${ctx.runId}, ${inst}, 'series_inferred', 'events', ${id},
              ${JSON.stringify({ series: id, name, events: members.map((m) => m.id), years: [...new Set(members.map((m) => m.year))] })}::jsonb)`;
  }
}
