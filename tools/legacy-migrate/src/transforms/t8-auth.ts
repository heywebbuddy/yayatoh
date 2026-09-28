import { dualHash, GRACE_DAYS, parseDualHash } from '@yayatoh/auth/compat';
import { exec, hasColumn, hasTable, rows, type StepContext } from './context.ts';

/**
 * T8 Auth artifacts (roadmap §7.5, M2.2c). Only hashes are stored (`auth.legacy_tokens`).
 *
 * - **Personal access tokens** (Sanctum; the mobile apps' bearer `{id}|{secret}`): each user's live
 *   token is carried per instance with the SHA-256 the legacy table already held, its name,
 *   abilities, last use and expiry. Expired at the freeze → not carried (counted); a token whose
 *   user was not migrated → revoked (listed); a malformed hash → listed.
 * - **Magic login links** (72 h, plain text in `users.magic_login_token`): kept until expiry, as
 *   the SHA-256 of the token. Expired at the freeze → dropped.
 * - **Password resets**: kept only when under 60 minutes old at the freeze (bcrypt as stored),
 *   valid for the rest of that hour. OTPs are never carried.
 * - **Dual-hash grace** (roadmap T1): a merged identity whose eligible legacy accounts had
 *   different passwords accepts either for 180 days after the freeze, then only the primary. The
 *   account stores `$yydual$…` (packages/auth `dualHash`); the first sign-in rehashes to Argon2id.
 */
export async function t8Auth(ctx: StepContext): Promise<void> {
  if (await hasTable(ctx, 'personal_access_tokens'))
    await exec(
      ctx,
      `
      drop table if exists t8_pat;
      create temp table t8_pat as
      select p.id as legacy_id, u.new_id as user_id, lower(btrim(p.token)) as token_hash, left(btrim(coalesce(p.name, '')), 120) as name,
             legacy.try_jsonb(p.abilities) as abilities,
             (p.last_used_at at time zone {tz}) as last_used_at, (p.expires_at at time zone {tz}) as expires_at,
             coalesce((p.created_at at time zone {tz}), {freeze}) as created
      from {s}.personal_access_tokens p
      left join legacy.ref u on u.instance = {inst} and u.entity = 'users' and u.legacy_id = p.tokenable_id::text
                             and p.tokenable_type ilike '%user';

      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      select {run}, {inst}, case when user_id is null then 'access_token_revoked_no_user' else 'access_token_malformed' end,
             'personal_access_tokens', legacy_id::text, '{}'::jsonb
      from t8_pat where user_id is null or token_hash !~ '^[0-9a-f]{64}$';

      insert into auth.legacy_tokens (id, instance, kind, legacy_id, user_id, token_hash, name, abilities, last_used_at,
                                      expires_at, created_at)
      select legacy.det_uuid(created, {inst} || '|personal_access_tokens|' || legacy_id), {inst}, 'personal_access',
             legacy_id::text, user_id, token_hash, nullif(name, ''),
             case when jsonb_typeof(abilities) = 'array' then abilities else '["*"]'::jsonb end,
             last_used_at, expires_at, created
      from t8_pat
      where user_id is not null and token_hash ~ '^[0-9a-f]{64}$' and (expires_at is null or expires_at > {freeze})
      on conflict (id) do update set last_used_at = excluded.last_used_at, expires_at = excluded.expires_at;
    `,
    );

  if (await hasColumn(ctx, 'users', 'magic_login_token'))
    await exec(
      ctx,
      `
      insert into auth.legacy_tokens (id, instance, kind, legacy_id, user_id, token_hash, expires_at, created_at)
      select legacy.det_uuid(null, {inst} || '|magic_login|' || u.id || '|' || encode(sha256(convert_to(btrim(u.magic_login_token), 'UTF8')), 'hex')),
             {inst}, 'magic_login', u.id::text, r.new_id,
             encode(sha256(convert_to(btrim(u.magic_login_token), 'UTF8')), 'hex'),
             (u.magic_login_expires_at at time zone {tz}), {freeze}
      from {s}.users u
      join legacy.ref r on r.instance = {inst} and r.entity = 'users' and r.legacy_id = u.id::text
      where length(btrim(coalesce(u.magic_login_token, ''))) >= 32
        and (u.magic_login_expires_at at time zone {tz}) > {freeze}
      on conflict (instance, kind, legacy_id) do update
        set token_hash = excluded.token_hash, expires_at = excluded.expires_at
        where auth.legacy_tokens.revoked_at is null;
    `,
    );

  if (await hasTable(ctx, 'password_resets'))
    await exec(
      ctx,
      `
      insert into auth.legacy_tokens (id, instance, kind, legacy_id, user_id, token_hash, expires_at, created_at)
      select legacy.det_uuid(x.created, {inst} || '|password_resets|' || x.email || '|' || x.created),
             {inst}, 'password_reset', x.email || '|' || x.created, au.id, x.token, x.created + interval '60 minutes', x.created
      from (select legacy.email_norm(email) as email, btrim(token) as token, (created_at at time zone {tz}) as created
            from {s}.password_resets) x
      join auth.users au on au.email = x.email
      where x.created > {freeze} - interval '60 minutes' and x.created <= {freeze} and x.token ~ '^\\$2[aby]\\$'
      on conflict (instance, kind, legacy_id) do nothing;
    `,
    );

  // Dual-hash grace for merged identities (both instances' passwords, 180 days).
  const merged = await rows<{ user_id: string; primary_hash: string; hashes: string[] }>(
    ctx,
    `select a.user_id, a.password as primary_hash,
            array_agg(distinct c.password_hash order by c.password_hash) as hashes
     from auth.accounts a
     join legacy.credentials c on c.user_id = a.user_id and (c.verified or c.has_paid)
     where a.provider_id = 'credential' and a.password ~ '^\\$(2[aby]|yydual)\\$'
       and a.user_id in (select distinct user_id from legacy.credentials where instance = {inst})
     group by a.user_id, a.password
     having count(distinct c.password_hash) > 1`,
  );
  // A dual hash whose second password is gone (a newer dump, a pre-hijack skip) is the primary again.
  await exec(
    ctx,
    `
    update auth.accounts a set password = split_part(substring(a.password from '^\\$yydual\\$[0-9]+\\$(.*)$'), '|', 1), updated_at = now()
    where a.provider_id = 'credential' and a.password like '$yydual$%'
      and a.user_id in (select distinct user_id from legacy.credentials where instance = {inst})
      and (select count(distinct c.password_hash) from legacy.credentials c
           where c.user_id = a.user_id and (c.verified or c.has_paid)) < 2;
  `,
  );
  const until = new Date(ctx.freezeAt.getTime() + GRACE_DAYS * 86_400_000);
  for (const m of merged) {
    const primary = parseDualHash(m.primary_hash)?.primary ?? m.primary_hash;
    const others = m.hashes.filter((h) => h !== primary);
    if (!primary || !others.length) continue;
    const value = dualHash(primary, others, until);
    if (value !== m.primary_hash)
      await ctx.sql`update auth.accounts set password = ${value}, updated_at = now()
                    where user_id = ${m.user_id} and provider_id = 'credential' and password = ${m.primary_hash}`;
  }
}
