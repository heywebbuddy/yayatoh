import { managedHostname } from '@yayatoh/tenancy';
import { detUuid, legacyKey, slugify } from '../ids.ts';
import { exec, rows, type StepContext } from './context.ts';

/** Legacy sub-account role → org membership role and (per assigned event) event role. */
export const SUB_ROLES: Record<number, { membership: string; eventRole: string | null }> = {
  4: { membership: 'box_office', eventRole: null }, // POS
  5: { membership: 'scanner', eventRole: 'door_staff' }, // Scanner
  6: { membership: 'manager', eventRole: 'event_manager' }, // Manager
};

interface OrgSource {
  legacy_id: string;
  name: string;
  owner_legacy_id: string | null;
  created: Date | string | null;
  stripe_account_id: string | null;
  parent: boolean;
}

/** Stable org id for an organizer (or the abc parent). */
export const orgIdFor = (instance: string, legacyId: string, created: Date | string | null) =>
  detUuid(created, legacyKey(instance, 'organizers', legacyId));

/**
 * T2 Orgs (roadmap §7.5). Each organizer becomes an org (kind organizer, `legacy_instance` set)
 * with its owner membership and the tenant-apex subdomain every org gets. Sub-accounts (POS,
 * scanner, manager) become memberships (box_office, scanner, manager); their per-event
 * assignments become event roles in T3. The abc instance becomes the parent ABC org: abc admins
 * are its admins (the earliest one its owner, pending owner confirmation), it owns
 * abc.yayatoh.com (added pending DNS; activated at cutover) and every other abc organizer is a
 * `host_affiliate` child org. Connected Stripe accounts carry over (`payment_accounts`, refreshed
 * from Stripe at cutover). Slugs: the organisation name, or `-{inst}-{id}` when taken.
 */
export async function t2Orgs(ctx: StepContext): Promise<void> {
  const inst = ctx.instance;
  const sources: OrgSource[] = await rows(
    ctx,
    `
    select u.id::text as legacy_id,
           coalesce(nullif(btrim(u.organisation), ''), nullif(btrim(u.name), ''), 'Organizer ' || u.id) as name,
           u.id::text as owner_legacy_id,
           (u.created_at at time zone {tz}) as created,
           nullif(btrim(u.stripe_account_id), '') as stripe_account_id,
           false as parent
    from {s}.users u where u.role_id = 3 and u.deleted_at is null
    order by u.id`,
  );
  if (inst === 'abc') {
    const admins = await rows<{ id: string; created: Date | null; org: string | null }>(
      ctx,
      `select u.id::text as id, (u.created_at at time zone {tz}) as created, nullif(btrim(u.organisation), '') as org
       from {s}.users u where u.role_id = 1 and u.deleted_at is null order by u.created_at nulls last, u.id`,
    );
    const first = admins[0];
    sources.unshift({
      legacy_id: 'parent',
      name: first?.org ?? 'ABC',
      owner_legacy_id: first?.id ?? null,
      created: first?.created ?? null,
      stripe_account_id: null,
      parent: true,
    });
  }

  const existing = new Map(
    (await ctx.sql<{ id: string; slug: string }[]>`select id, slug from tenancy.organizations`).map((r) => [
      r.slug,
      r.id,
    ]),
  );
  const existingIds = new Set(existing.values());
  const orgRows: Record<string, unknown>[] = [];
  for (const o of sources) {
    const id = orgIdFor(inst, o.legacy_id, o.created);
    if (existingIds.has(id)) {
      orgRows.push({ id, skip: true, o });
      continue;
    }
    let slug = o.parent ? 'abc' : slugify(o.name, 40);
    if (existing.has(slug) || slug.length < 3) slug = `${slugify(o.name, 30)}-${inst}-${o.legacy_id}`;
    existing.set(slug, id);
    orgRows.push({ id, slug, o });
  }
  const created = orgRows.filter((r) => !r.skip) as { id: string; slug: string; o: OrgSource }[];
  if (created.length) {
    await ctx.sql`
      insert into tenancy.organizations ${ctx.sql(
        created.map(({ id, slug, o }) => ({
          id,
          org_id: id,
          slug,
          name: o.name.slice(0, 200),
          kind: 'organizer',
          status: 'active',
          default_profile: 'other',
          timezone: ctx.platformTz,
          country: 'US',
          currency: ctx.currency,
          legacy_instance: inst,
          created_at: o.created ? new Date(o.created).toISOString() : '2019-01-01T00:00:00Z',
        })),
      )}
      on conflict (id) do nothing`;
    // The tenant-apex subdomain comes with every org (as tenancy's ensureManagedDomain does).
    await ctx.sql`
      insert into tenancy.org_domains ${ctx.sql(
        created.map(({ id, slug }) => ({
          id: detUuid(null, `org_domain|${id}`),
          org_id: id,
          hostname: managedHostname(slug),
          managed: true,
          status: 'active',
          ssl_status: 'issued',
          is_primary: true,
          activated_at: new Date().toISOString(),
        })),
      )}
      on conflict do nothing`;
    // M6.6a (P6-7): migrated organizers keep their legacy per-ticket fees when subscriptions switch on.
    await ctx.sql`
      insert into billing.org_billing ${ctx.sql(
        created.map(({ id }) => ({
          id: detUuid(null, `org_billing|${id}`),
          org_id: id,
          legacy_fees_grandfathered: true,
          grandfathered_reason: 'legacy_migration',
        })),
      )}
      on conflict do nothing`;
  }
  const all = orgRows as { id: string; o: OrgSource }[];
  await ctx.sql`
    insert into legacy.ref ${ctx.sql(
      all.map(({ id, o }) => ({
        instance: inst,
        entity: 'organizers',
        legacy_id: o.legacy_id,
        new_id: id,
        org_id: id,
        compat_id: o.parent ? null : Number(o.legacy_id),
      })),
    )}
    on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id, org_id = excluded.org_id`;

  await exec(
    ctx,
    `
    -- Owners: the organizer's own (migrated) user.
    insert into tenancy.memberships (id, org_id, user_id, role, created_at)
    select legacy.det_uuid(null, 'membership|' || o.new_id || '|' || u.new_id), o.new_id, u.new_id, 'owner', now()
    from legacy.ref o
    join legacy.ref u on u.instance = o.instance and u.entity = 'users' and u.legacy_id = o.legacy_id
    where o.instance = {inst} and o.entity = 'organizers' and o.legacy_id <> 'parent'
    on conflict (org_id, user_id) do nothing;

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'org_without_owner', 'users', o.legacy_id, jsonb_build_object('org_id', o.new_id)
    from legacy.ref o
    where o.instance = {inst} and o.entity = 'organizers' and o.legacy_id <> 'parent'
      and not exists (select 1 from legacy.ref u where u.instance = o.instance and u.entity = 'users' and u.legacy_id = o.legacy_id);

    -- Sub-accounts → memberships in their organizer's org.
    insert into tenancy.memberships (id, org_id, user_id, role, created_at)
    select legacy.det_uuid(null, 'membership|' || o.new_id || '|' || u.new_id), o.new_id, u.new_id,
           case s.role_id when 4 then 'box_office' when 5 then 'scanner' else 'manager' end, now()
    from {s}.users s
    join legacy.ref u on u.instance = {inst} and u.entity = 'users' and u.legacy_id = s.id::text
    join legacy.ref o on o.instance = {inst} and o.entity = 'organizers' and o.legacy_id = s.organizer_id::text
    where s.role_id in (4, 5, 6) and s.deleted_at is null
    on conflict (org_id, user_id) do nothing;

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'sub_account_orphan', 'users', s.id::text, jsonb_build_object('organizer_id', s.organizer_id)
    from {s}.users s
    where s.role_id in (4, 5, 6) and s.deleted_at is null
      and not exists (select 1 from legacy.ref o where o.instance = {inst} and o.entity = 'organizers' and o.legacy_id = s.organizer_id::text);
  `,
  );

  if (inst === 'abc') {
    await exec(
      ctx,
      `
      -- ABC admins: the earliest is the owner (pending owner confirmation), the rest admins.
      insert into tenancy.memberships (id, org_id, user_id, role, created_at)
      select legacy.det_uuid(null, 'membership|' || p.new_id || '|' || u.new_id), p.new_id, u.new_id,
             case when row_number() over (order by a.created_at nulls last, a.id) = 1 then 'owner' else 'admin' end, now()
      from {s}.users a
      join legacy.ref u on u.instance = {inst} and u.entity = 'users' and u.legacy_id = a.id::text
      join legacy.ref p on p.instance = {inst} and p.entity = 'organizers' and p.legacy_id = 'parent'
      where a.role_id = 1 and a.deleted_at is null
      on conflict (org_id, user_id) do nothing;

      -- Events the abc admins created belong to the parent org.
      insert into legacy.ref (instance, entity, legacy_id, new_id, org_id, compat_id)
      select {inst}, 'organizers', a.id::text, p.new_id, p.new_id, a.id
      from {s}.users a join legacy.ref p on p.instance = {inst} and p.entity = 'organizers' and p.legacy_id = 'parent'
      where a.role_id = 1
      on conflict (instance, entity, legacy_id) do nothing;

      -- Every other abc organizer is a host_affiliate child of ABC.
      insert into tenancy.org_relationships (id, org_id, child_org_id, kind, source, created_at)
      select legacy.det_uuid(null, 'org_rel|' || p.new_id || '|' || o.new_id), p.new_id, o.new_id, 'host_affiliate', 'legacy:abc', now()
      from legacy.ref o
      join legacy.ref p on p.instance = {inst} and p.entity = 'organizers' and p.legacy_id = 'parent'
      join {s}.users u on u.id::text = o.legacy_id and u.role_id = 3
      where o.instance = {inst} and o.entity = 'organizers'
      on conflict (org_id, child_org_id, kind) do nothing;

      -- ABC owns abc.yayatoh.com: added pending DNS, activated by staff at cutover.
      insert into tenancy.org_domains (id, org_id, hostname, managed, status, is_primary)
      select legacy.det_uuid(null, 'org_domain|abc.yayatoh.com'), p.new_id, 'abc.yayatoh.com', false, 'pending_dns', false
      from legacy.ref p where p.instance = {inst} and p.entity = 'organizers' and p.legacy_id = 'parent'
      on conflict do nothing;
    `,
    );
  }

  // Connected Stripe accounts (Standard, direct charges): carried over, capabilities refreshed from
  // Stripe at cutover (until then charges stay off, so new orders use platform_mor).
  await exec(
    ctx,
    `
    insert into payments.payment_accounts (id, org_id, provider, account_id, account_class, country, default_currency)
    select legacy.det_uuid(null, 'payment_account|' || o.new_id), o.new_id, 'stripe', btrim(u.stripe_account_id), 'standard', 'US', {cur}
    from {s}.users u
    join legacy.ref o on o.instance = {inst} and o.entity = 'organizers' and o.legacy_id = u.id::text
    where u.role_id = 3 and u.stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
    on conflict (org_id) do nothing;
  `,
  );
}
