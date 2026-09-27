import type { MigratorSql } from '@yayatoh/db/migration';
import { venueTimezoneRows } from './time.ts';

/**
 * The `legacy` control schema (platform-owned, migrator only; never granted to app_user or
 * platform_reader): runs, the legacy id map, quarantine, exceptions for owner review, carried
 * credentials, and the SQL twins of src/ids.ts and src/time.ts. Idempotent and versioned: every
 * run re-applies it (`CREATE … IF NOT EXISTS`, `CREATE OR REPLACE`).
 */
export const CONTROL_VERSION = 1;

const DDL = `
create schema if not exists legacy;
revoke all on schema legacy from public;

create table if not exists legacy.meta (key text primary key, value text not null);

create table if not exists legacy.runs (
  id bigserial primary key,
  instance text not null check (instance in ('yay', 'abc')),
  mode text not null check (mode in ('rehearsal', 'cutover')),
  stage text,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  dump_sha256 text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  timings jsonb not null default '{}'::jsonb,
  report jsonb
);

-- Legacy id ↔ new id, per instance (roadmap §5.1 legacy_ref / compat_ids). compat_id is the
-- legacy integer id where the old apps and URLs use one (e.g. a booking's id for its ticket).
create table if not exists legacy.ref (
  instance text not null,
  entity text not null,
  legacy_id text not null,
  new_id uuid not null,
  org_id uuid,
  compat_id bigint,
  primary key (instance, entity, legacy_id)
);
create index if not exists ref_new_id_idx on legacy.ref (new_id);

create table if not exists legacy.quarantine (
  id bigserial primary key,
  run_id bigint not null,
  instance text not null,
  table_name text not null,
  legacy_id text,
  column_name text,
  reason text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists quarantine_run_idx on legacy.quarantine (run_id, table_name);

-- Everything the owner reviews that is not a quarantined row: orphans kept in a holding org,
-- timezone fallbacks and DST folds/gaps, duplicate QR payloads, skipped credentials, legacy admins.
create table if not exists legacy.exceptions (
  id bigserial primary key,
  run_id bigint not null,
  instance text not null,
  kind text not null,
  legacy_table text,
  legacy_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists exceptions_run_idx on legacy.exceptions (run_id, kind);

-- Every legacy password hash seen for a merged identity (T1). The primary credential is copied to
-- auth.accounts; the others wait for the dual-hash grace period (Later).
create table if not exists legacy.credentials (
  instance text not null,
  legacy_user_id bigint not null,
  user_id uuid not null,
  password_hash text not null,
  verified boolean not null,
  has_paid boolean not null,
  legacy_created_at timestamptz,
  primary key (instance, legacy_user_id)
);
create index if not exists credentials_user_idx on legacy.credentials (user_id);

create table if not exists legacy.venue_tz (
  country text not null,
  state text not null,
  tz text not null,
  primary key (country, state)
);

create table if not exists legacy.instance_settings (
  instance text primary key,
  platform_tz text not null,
  currency text not null,
  commission_bps integer not null,
  event_clock text not null check (event_clock in ('platform', 'venue'))
);

-- Deterministic UUIDv7 (src/ids.ts detUuid): 48-bit ms from ts, version 7, variant 10xx, rest from
-- SHA-256(key).
create or replace function legacy.det_uuid(ts timestamptz, key text) returns uuid
language sql immutable parallel safe as $$
  with v as (
    select least(greatest(floor(extract(epoch from coalesce(ts, '2019-01-01 00:00:00+00'::timestamptz)) * 1000)::bigint, 0), 281474976710655) as ms,
           encode(sha256(convert_to(key, 'UTF8')), 'hex') as h
  )
  select (lpad(to_hex(ms), 12, '0') || '7' || substr(h, 1, 3)
          || to_hex(8 | (('x' || substr(h, 4, 1))::bit(4)::int & 3)) || substr(h, 5, 15))::uuid
  from v
$$;

-- lower(nfkc(trim(email))) (src/ids.ts emailNorm).
create or replace function legacy.email_norm(e text) returns text
language sql immutable parallel safe as $$
  select lower(btrim(normalize(btrim(e, E' \\t\\n\\r\\f\\v'), NFKC), E' \\t\\n\\r\\f\\v'))
$$;

create or replace function legacy.email_ok(e text) returns boolean
language sql immutable parallel safe as $$
  select e is not null and length(e) <= 254 and e ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'
$$;

create or replace function legacy.try_jsonb(t text) returns jsonb
language plpgsql immutable parallel safe as $$
begin
  return t::jsonb;
exception when others then
  return null;
end
$$;

-- Decimal text in major units → integer minor units; null when not a plain decimal.
create or replace function legacy.to_minor(t text) returns bigint
language sql immutable parallel safe as $$
  select case when btrim(t) ~ '^-?[0-9]+(\\.[0-9]+)?$' then round(btrim(t)::numeric * 100)::bigint end
$$;

-- Ticket short code from its id (src/ids.ts shortCode).
create or replace function legacy.short_code(id uuid, salt integer) returns text
language sql immutable parallel safe as $$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(h, i) % 30) + 1, 1), '' order by i)
  from (select sha256(convert_to(id::text || ':' || salt::text, 'UTF8')) as h) x,
       generate_series(0, 7) as i
$$;

-- Check-in instant: UTC time of day on the UTC date that falls on the regional day (src/time.ts).
create or replace function legacy.checkin_instant(day date, t time, tz text) returns timestamptz
language sql stable parallel safe as $$
  select coalesce(
    (select c from (values (0, ((day + t) at time zone 'UTC')),
                           (1, (((day + 1) + t) at time zone 'UTC')),
                           (2, (((day - 1) + t) at time zone 'UTC'))) v(o, c)
     where (c at time zone tz)::date = day order by o limit 1),
    (day + t) at time zone 'UTC')
$$;

-- 'ok', 'fold' (the wall time occurs twice) or 'gap' (it never occurs) in tz (src/time.ts).
create or replace function legacy.local_kind(w timestamp, tz text) returns text
language sql stable parallel safe as $$
  select case
    when ((w at time zone tz) at time zone tz) <> w then 'gap'
    when (((w at time zone tz) - interval '1 hour') at time zone tz) = w
      or (((w at time zone tz) + interval '1 hour') at time zone tz) = w then 'fold'
    else 'ok' end
$$;
`;

export async function ensureControlSchema(sql: MigratorSql): Promise<void> {
  await sql.unsafe(DDL);
  // The runtime roles never see the control schema (its tables would otherwise inherit the
  // migrator's default privileges).
  await sql.unsafe(
    `revoke all on all tables in schema legacy from app_user, platform_reader;
     revoke all on all sequences in schema legacy from app_user, platform_reader;
     revoke all on all functions in schema legacy from public;`,
  );
  const rows = venueTimezoneRows();
  await sql`insert into legacy.venue_tz ${sql(rows, 'country', 'state', 'tz')} on conflict (country, state) do update set tz = excluded.tz`;
  await sql`insert into legacy.meta (key, value) values ('control_version', ${String(CONTROL_VERSION)})
            on conflict (key) do update set value = excluded.value`;
}

/** Quote an identifier (schema/table/column names come from the dump). */
export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
export const stagingSchema = (instance: string) => `legacy_${instance}`;
