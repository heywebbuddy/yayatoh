import { exec, hasColumn, hasTable, type StepContext } from './context.ts';

/**
 * The media manifest (roadmap §7.5 "Media"; M2.2d): every legacy upload a migrated row references,
 * in `legacy.media_refs`, with the R2 key the media copy writes it to (`legacy.media_key`, the SQL
 * twin of `legacyMediaUrl`: `legacy/{inst}/storage/…`, as M2.2c's plan underlays) and its target:
 * - `media:event:cover` / `media:event:gallery` / `media:venue:photo`: owner slots of the media
 *   pipeline (M1.4e). The import step runs those files through it (sniffed, re-encoded, EXIF
 *   stripped; never served as uploaded);
 * - `underlay:seating.layouts`: a seat chart's image, already the plan's underlay key;
 * - `none:<table>`: the new module has no image for it yet (speaker avatars, exhibitor logos,
 *   session thumbnails, performer images, CMS images); listed once per kind (`media_no_target`).
 * Nothing is fetched here: the manifest is data. External URLs (http…) are not legacy uploads and
 * are listed (`media_external_url`). Rebuilt on every run.
 */
export async function mediaRefs(ctx: StepContext): Promise<void> {
  await exec(ctx, `delete from legacy.media_refs where instance = {inst}`);
  // (entity, legacy table, role, target, the SQL yielding legacy_id, new_id, org_id, path, position)
  const sources: { table: string; sql: string }[] = [];
  const img = (expr: string) => `nullif(btrim(${expr}), '')`;
  if (await hasTable(ctx, 'seatcharts'))
    sources.push({
      table: 'seatcharts',
      sql: `select 'seatcharts' as entity, c.id::text as legacy_id, 'underlay' as role, 0 as position,
                   ${img('c.chart_image')} as path, r.new_id, r.org_id, 'underlay:seating.layouts' as target
            from {s}.seatcharts c join legacy.ref r on r.instance = {inst} and r.entity = 'seatcharts' and r.legacy_id = c.id::text`,
    });
  const jsonImages = (
    table: string,
    entity: string,
    role: (k: string) => string,
    target: (k: string) => string,
  ) => `
    select '${entity}' as entity, x.id::text as legacy_id, ${role('i.k')} as role,
           (i.k - 1)::int as position, ${img('i.v')} as path, r.new_id, r.org_id, ${target('i.k')} as target
    from {s}.${table} x
    join legacy.ref r on r.instance = {inst} and r.entity = '${entity}' and r.legacy_id = x.id::text
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(legacy.try_jsonb(x.images::text)) = 'array' then legacy.try_jsonb(x.images::text) else '[]'::jsonb end
    ) with ordinality i(v, k)`;
  if (await hasColumn(ctx, 'events', 'images'))
    sources.push({
      table: 'events',
      sql: jsonImages(
        'events',
        'events',
        (k) => `case when ${k} = 1 then 'cover' else 'gallery' end`,
        (k) => `case when ${k} = 1 then 'media:event:cover' else 'media:event:gallery' end`,
      ),
    });
  if ((await hasTable(ctx, 'venues')) && (await hasColumn(ctx, 'venues', 'images')))
    sources.push({
      table: 'venues',
      sql: jsonImages(
        'venues',
        'venues',
        () => `'photo'`,
        () => `'media:venue:photo'`,
      ),
    });
  const single = (table: string, entity: string, col: string, role: string, targetTable: string) => ({
    table,
    sql: `select '${entity}' as entity, x.id::text as legacy_id, '${role}' as role, 0 as position, ${img(`x.${col}`)} as path,
                 r.new_id, r.org_id, 'none:${targetTable}' as target
          from {s}.${table} x join legacy.ref r on r.instance = {inst} and r.entity = '${entity}' and r.legacy_id = x.id::text`,
  });
  if (await hasTable(ctx, 'event_speakers'))
    sources.push(single('event_speakers', 'event_speakers', 'avatar', 'avatar', 'program.speakers'));
  if (await hasTable(ctx, 'event_sessions'))
    sources.push(single('event_sessions', 'event_sessions', 'thumbnail', 'thumbnail', 'program.sessions'));
  if (await hasTable(ctx, 'event_exhibitors'))
    sources.push(single('event_exhibitors', 'event_exhibitors', 'logo', 'logo', 'program.exhibitors'));
  for (const t of ['pages', 'posts'])
    if ((await hasTable(ctx, t)) && (await hasColumn(ctx, t, 'image')))
      sources.push(single(t, t, 'image', 'image', 'cms.entries'));
  if ((await hasTable(ctx, 'tags')) && (await hasTable(ctx, 'event_tag')))
    sources.push({
      table: 'tags',
      sql: `select 'event_tag' as entity, r.legacy_id, 'image' as role, 0 as position, ${img('t.image')} as path,
                   r.new_id, r.org_id, 'none:program.speakers' as target
            from legacy.ref r join {s}.tags t on t.id::text = split_part(r.legacy_id, ':', 1)
            where r.instance = {inst} and r.entity = 'event_tag'`,
    });
  if (!sources.length) return;
  await exec(
    ctx,
    `
    drop table if exists t_media;
    create temp table t_media as
    ${sources.map((s) => `(${s.sql})`).join('\nunion all\n')};

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'media_external_url', entity, legacy_id, jsonb_build_object('role', role)
    from t_media where path ~* '^[a-z]+://';

    insert into legacy.media_refs (instance, entity, legacy_id, role, position, path, storage_key, new_id, org_id, target,
                                   width_px, height_px, run_id)
    select {inst}, m.entity, m.legacy_id, m.role, m.position, m.path, legacy.media_key({inst}, m.path), m.new_id, m.org_id,
           m.target, i.width_px, i.height_px, {run}
    from t_media m
    left join legacy.media_images i on i.instance = {inst} and i.path = m.path
    where m.path is not null and m.path !~* '^[a-z]+://'
    on conflict do nothing;

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'media_no_target', entity, role, jsonb_build_object('target', target, 'refs', count(*))
    from legacy.media_refs where instance = {inst} and target like 'none:%'
    group by entity, role, target;
  `,
  );
}
