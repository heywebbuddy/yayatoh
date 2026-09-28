import { detUuid, legacyKey } from '../ids.ts';
import { exec, hasColumn, hasTable, type StepContext } from './context.ts';

/**
 * T6 Communications (roadmap §7.5, M2.2c).
 *
 * - **Consent is never invented.** Newsletter subscribers become contacts of the instance's
 *   platform-level org (yayatoh.com: the `yayatoh` platform org, created here; abc: the ABC org)
 *   with a `granted` email-marketing consent (`evidence = legacy_newsletter`, at the subscription
 *   time) and, when they unsubscribed, a later `withdrawn` one. Every other migrated contact gets
 *   `unknown_legacy` (`evidence = legacy_import:{inst}`): the messaging policy decides per purpose
 *   and jurisdiction. Nobody is opted in.
 * - **Push tokens.** A user's legacy FCM / APNs token is registered (source `legacy`) in the org
 *   the app served them for: an organizer's or sub-account's own org(s), else the platform-level
 *   org of the instance.
 * - **Database notifications** are not carried: they are alerts about the old app, and their data
 *   holds generated guest passwords in plain text (M2.2a finding). They stay in staging (12 months).
 *   Chats, blocks and message reports: M2.2d (the messaging module is merging in parallel).
 * - **The buyer order-link plan.** Buyers of migrated orders whose event has not ended at the
 *   freeze get a "your new order link" message after cutover. The plan (`legacy.order_link_plan`)
 *   lists them with skip reasons; `pnpm migrate:legacy:order-links --instance=…` prints the
 *   dry-run report. The migration never sends anything.
 */
export async function t6Comms(ctx: StepContext): Promise<void> {
  const hostOrg = await platformOrg(ctx);

  if (await hasTable(ctx, 'newsletter_subscribers'))
    await exec(
      ctx,
      `
      drop table if exists t6_news;
      create temp table t6_news as
      select n.id as legacy_id, legacy.email_norm(n.email) as email, nullif(btrim(n.name), '') as name,
             coalesce((n.created_at at time zone {tz}), {freeze}) as subscribed_at,
             (n.unsubscribed_at at time zone {tz}) as unsubscribed_at
      from {s}.newsletter_subscribers n;

      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      select {run}, {inst}, 'newsletter_invalid_email', 'newsletter_subscribers', legacy_id::text, '{}'::jsonb
      from t6_news where not legacy.email_ok(email);
      delete from t6_news where not legacy.email_ok(email);

      insert into crm.contacts (id, org_id, email, email_norm, name, user_id, source, created_at, updated_at)
      select distinct on (email)
             legacy.det_uuid(subscribed_at, {inst} || '|contacts|' || '${hostOrg}' || '|' || email), '${hostOrg}'::uuid,
             email, email, left(name, 200), (select u.id from auth.users u where u.email = n.email), 'legacy',
             subscribed_at, subscribed_at
      from t6_news n order by email, subscribed_at
      on conflict (org_id, email_norm) do nothing;

      insert into crm.consents (id, org_id, contact_id, channel, purpose, status, evidence, captured_at)
      select legacy.det_uuid(n.subscribed_at, {inst} || '|consents|newsletter|' || n.legacy_id), c.org_id, c.id,
             'email', 'marketing', 'granted', 'legacy_newsletter', n.subscribed_at
      from t6_news n join crm.contacts c on c.org_id = '${hostOrg}' and c.email_norm = n.email
      on conflict (id) do nothing;
      insert into crm.consents (id, org_id, contact_id, channel, purpose, status, evidence, captured_at)
      select legacy.det_uuid(n.unsubscribed_at, {inst} || '|consents|newsletter-off|' || n.legacy_id), c.org_id, c.id,
             'email', 'marketing', 'withdrawn', 'legacy_newsletter_unsubscribe', greatest(n.unsubscribed_at, n.subscribed_at)
      from t6_news n join crm.contacts c on c.org_id = '${hostOrg}' and c.email_norm = n.email
      where n.unsubscribed_at is not null
      on conflict (id) do nothing;
    `,
    );

  // unknown_legacy for every other migrated contact of this instance's orgs.
  await exec(
    ctx,
    `
    insert into crm.consents (id, org_id, contact_id, channel, purpose, status, evidence, captured_at)
    select legacy.det_uuid(c.created_at, {inst} || '|consents|unknown|' || c.id), c.org_id, c.id,
           'email', 'marketing', 'unknown_legacy', 'legacy_import:' || {inst}, c.created_at
    from crm.contacts c
    where c.source = 'legacy'
      and c.org_id in (select distinct org_id from legacy.ref where instance = {inst} and entity = 'organizers'
                       union select '${hostOrg}'::uuid)
      and not exists (select 1 from crm.consents x where x.org_id = c.org_id and x.contact_id = c.id
                      and x.channel = 'email' and x.purpose = 'marketing')
    on conflict (id) do nothing;
  `,
  );

  // Push tokens.
  if (await hasColumn(ctx, 'users', 'fcm_token'))
    await exec(
      ctx,
      `
      drop table if exists t6_push;
      create temp table t6_push as
      select r.new_id as user_id, t.platform, btrim(t.token) as token,
             coalesce((u.updated_at at time zone {tz}), {freeze}) as seen, u.role_id, u.id as legacy_id, u.organizer_id
      from {s}.users u
      join legacy.ref r on r.instance = {inst} and r.entity = 'users' and r.legacy_id = u.id::text
      cross join lateral (values ('fcm', u.fcm_token), ('apns', u.apn_token)) t(platform, token)
      where length(btrim(coalesce(t.token, ''))) between 8 and 4096;

      insert into notifications.push_tokens (id, org_id, user_id, platform, token, source, last_seen_at, created_at, updated_at)
      select distinct on (x.org_id, p.platform, p.token)
             legacy.det_uuid(p.seen, {inst} || '|push_tokens|' || x.org_id || '|' || p.platform || '|' || p.token),
             x.org_id, p.user_id, p.platform, p.token, 'legacy', p.seen, p.seen, p.seen
      from t6_push p
      cross join lateral (
        select m.org_id from tenancy.memberships m
        join legacy.ref o on o.instance = {inst} and o.entity = 'organizers' and o.org_id = m.org_id
        where m.user_id = p.user_id and p.role_id <> 2
        union
        select '${hostOrg}'::uuid where p.role_id = 2 or p.role_id is null
      ) x
      order by x.org_id, p.platform, p.token, p.seen desc
      on conflict (org_id, platform, token) do nothing;
    `,
    );

  // The buyer order-link plan (never sent here).
  await exec(
    ctx,
    `
    delete from legacy.order_link_plan where instance = {inst};
    insert into legacy.order_link_plan (instance, order_id, org_id, event_id, buyer_email, locale, event_ends_at, active_tickets,
                                        status, skip_reason, run_id)
    select {inst}, o.id, o.org_id, o.event_id, o.buyer_email, o.locale, e.ends_at,
           (select count(*) from ticketing.tickets t where t.org_id = o.org_id and t.order_id = o.id and t.status = 'active')::int,
           'planned', null, {run}
    from orders.orders o
    join legacy.ref r on r.instance = {inst} and r.entity = 'orders' and r.new_id = o.id
    join events.events e on e.id = o.event_id
    where e.ends_at > {freeze};
    update legacy.order_link_plan p set status = 'skipped', skip_reason = x.reason
    from (
      select p.order_id,
             case when not legacy.email_ok(p.buyer_email) then 'invalid_email'
                  when o.status not in ('paid', 'partially_refunded') then 'order_' || o.status
                  when p.active_tickets = 0 then 'no_active_tickets'
                  when o.manage_token_hash like 'legacy-unissued:%' then 'no_manage_link' end as reason
      from legacy.order_link_plan p join orders.orders o on o.id = p.order_id
      where p.instance = {inst}
    ) x
    where p.instance = {inst} and p.order_id = x.order_id and x.reason is not null;
  `,
  );
}

/**
 * The org that holds an instance's platform-level data (newsletter, consumer app tokens): ABC for
 * abc; for yayatoh.com the `yayatoh` platform org (kind `platform`, status limited; pending owner),
 * created on first use.
 */
export async function platformOrg(ctx: StepContext): Promise<string> {
  if (ctx.instance === 'abc') {
    const [abc] = await ctx.sql<{ new_id: string }[]>`
      select new_id from legacy.ref where instance = 'abc' and entity = 'organizers' and legacy_id = 'parent'`;
    if (!abc) throw new Error('T6: the ABC org is missing (T2 did not run)');
    return abc.new_id;
  }
  const id = detUuid(null, legacyKey('yay', 'organizers', 'platform'));
  const [taken] = await ctx.sql<
    { id: string }[]
  >`select id from tenancy.organizations where slug = 'yayatoh'`;
  const slug = !taken || taken.id === id ? 'yayatoh' : 'yayatoh-platform';
  await ctx.sql`
    insert into tenancy.organizations (id, org_id, slug, name, kind, status, timezone, currency, legacy_instance)
    values (${id}, ${id}, ${slug}, 'Yayatoh', 'platform', 'limited', ${ctx.platformTz}, ${ctx.currency}, 'yay')
    on conflict (id) do nothing`;
  await ctx.sql`
    insert into legacy.ref (instance, entity, legacy_id, new_id, org_id)
    values ('yay', 'platform_org', 'yay', ${id}, ${id})
    on conflict (instance, entity, legacy_id) do nothing`;
  return id;
}
