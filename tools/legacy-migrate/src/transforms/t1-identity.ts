import { exec, type StepContext } from './context.ts';

/**
 * T1 Identity (roadmap §7.5). One global user per `lower(nfkc(trim(email)))` across both instances
 * and any beta users already on the platform:
 *  - ids are deterministic: the earliest legacy `created_at` for the email on this instance, and
 *    SHA-256 of `user|<email>` (so a person keeps one id whichever instance is migrated first);
 *  - an existing account (a beta user, or the other instance's twin) is never overwritten;
 *  - every legacy bcrypt hash is kept in `legacy.credentials`; the primary one goes to
 *    `auth.accounts` (Laravel `$2y$` verifies and is rehashed to Argon2id on first sign-in);
 *  - pre-hijack guard: in a merged identity (more than one legacy account, or a beta account), a
 *    credential from an account that never verified its email and never paid is not carried;
 *  - a password set on the new platform (Argon2id) always wins over any legacy hash;
 *  - platform staff never come from legacy data (owner-approved list only); legacy admins are listed
 *    for review, and abc admins become ABC org admins in T2.
 * Soft-deleted accounts and addresses that are not emails are not migrated as users (listed as
 * exceptions); their bookings still migrate with the booking's buyer details.
 */
export async function t1Identity(ctx: StepContext): Promise<void> {
  await exec(
    ctx,
    `
    drop table if exists t1_src;
    create temp table t1_src as
    select u.id as legacy_id,
           legacy.email_norm(u.email) as norm,
           coalesce(nullif(btrim(u.name), ''), split_part(legacy.email_norm(u.email), '@', 1)) as name,
           u.password,
           u.email_verified_at is not null as verified,
           u.role_id,
           u.deleted_at,
           coalesce((u.created_at at time zone {tz}), (u.updated_at at time zone {tz})) as created,
           exists (select 1 from {s}.bookings b
                   where b.customer_id = u.id and b.is_paid = 1 and coalesce(b.net_price, 0) > 0
                     and coalesce(b.booking_cancel, 0) < 2) as has_paid
    from {s}.users u;
    create index on t1_src (norm);
    analyze t1_src;

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, case when deleted_at is not null then 'user_deleted_skipped' else 'user_invalid_email' end,
           'users', legacy_id::text, jsonb_build_object('role_id', role_id)
    from t1_src where deleted_at is not null or not legacy.email_ok(norm);

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'legacy_admin', 'users', legacy_id::text,
           jsonb_build_object('email', norm, 'note', case when {inst} = 'abc' then 'becomes an ABC org admin (T2)'
                                                          else 'not platform staff: staff come only from the owner-approved list' end)
    from t1_src where role_id = 1 and deleted_at is null;

    delete from t1_src where deleted_at is not null or not legacy.email_ok(norm);

    -- One row per identity on this instance: the earliest account names it.
    insert into auth.users (id, name, email, email_verified, created_at, updated_at)
    select distinct on (norm)
           legacy.det_uuid(min(created) over (partition by norm), 'user|' || norm),
           name, norm, bool_or(verified) over (partition by norm),
           coalesce(min(created) over (partition by norm), '2019-01-01 00:00:00+00'), now()
    from t1_src
    order by norm, created nulls last, legacy_id
    on conflict (email) do nothing;

    insert into legacy.ref (instance, entity, legacy_id, new_id, compat_id)
    select {inst}, 'users', s.legacy_id::text, u.id, s.legacy_id
    from t1_src s join auth.users u on u.email = s.norm
    on conflict (instance, entity, legacy_id) do update set new_id = excluded.new_id;

    insert into legacy.credentials (instance, legacy_user_id, user_id, password_hash, verified, has_paid, legacy_created_at)
    select {inst}, s.legacy_id, u.id, s.password, s.verified, s.has_paid, s.created
    from t1_src s join auth.users u on u.email = s.norm
    where s.password ~ '^\\$2[aby]\\$'
    on conflict (instance, legacy_user_id) do update
      set user_id = excluded.user_id, password_hash = excluded.password_hash,
          verified = excluded.verified, has_paid = excluded.has_paid;
  `,
  );

  // Choose each touched identity's primary credential.
  await exec(
    ctx,
    `
    drop table if exists t1_pick;
    create temp table t1_pick as
    with touched as (select distinct user_id from legacy.credentials where instance = {inst}),
    ranked as (
      select c.*, (c.verified or c.has_paid) as eligible,
             count(*) over (partition by c.user_id) as sources,
             row_number() over (partition by c.user_id
                                order by (c.verified or c.has_paid) desc, c.verified desc,
                                         c.legacy_created_at desc nulls last, c.instance, c.legacy_user_id) as rn
      from legacy.credentials c join touched t using (user_id)
    ),
    beta as (
      -- A pre-existing account that is not only a legacy import (it has a non-bcrypt credential).
      select a.user_id from auth.accounts a join touched t using (user_id)
      where a.provider_id = 'credential' and a.password is not null and a.password !~ '^\\$(2[aby]|yydual)\\$'
    )
    select r.user_id, r.password_hash, r.eligible, r.sources, r.instance, r.legacy_user_id,
           (r.sources > 1 or exists (select 1 from beta b where b.user_id = r.user_id)) as merged,
           exists (select 1 from beta b where b.user_id = r.user_id) as has_new_password
    from ranked r where r.rn = 1;

    insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
    select {run}, {inst}, 'credential_skipped_prehijack', 'users', c.legacy_user_id::text,
           jsonb_build_object('user_id', c.user_id)
    from legacy.credentials c join t1_pick p using (user_id)
    where c.instance = {inst} and p.merged and not (c.verified or c.has_paid);

    -- Carry the primary credential unless the identity is merged and no legacy account is eligible,
    -- and never over a password set on the new platform.
    insert into auth.accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
    select legacy.det_uuid(null, 'credential|' || p.user_id), p.user_id::text, 'credential', p.user_id, p.password_hash, now(), now()
    from t1_pick p
    where not p.has_new_password and (p.eligible or not p.merged)
    on conflict (provider_id, account_id) do update
      set password = excluded.password, updated_at = now()
      where auth.accounts.password ~ '^\\$2[aby]\\$' and auth.accounts.password is distinct from excluded.password;

    -- A merged identity with no eligible legacy account keeps no legacy credential at all.
    delete from auth.accounts a using t1_pick p
    where a.user_id = p.user_id and a.provider_id = 'credential' and p.merged and not p.eligible
      and a.password ~ '^\\$2[aby]\\$';
  `,
  );
}
