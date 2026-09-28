import { verifyTicketCode } from '@yayatoh/ticket-crypto';
import { FACADE_STATUS } from './facade-diff.ts';
import { GOLDEN_QUERIES } from './golden.ts';
import type { Check } from './validate.ts';

/**
 * V6–V10 (roadmap §7.5 "Validation", M2.2c). Same rule as V1–V5: the legacy side is recomputed
 * from staging.
 */
type Row = Record<string, unknown>;
type Q = (text: string, params?: unknown[]) => Promise<Row[]>;
const n = (v: unknown) => Number(v ?? 0);

/** V6: legacy QR payloads, yy1 codes, access tokens, magic links and passwords (100% pass). */
export async function v6Vectors(q: Q, instance: string, freezeAt: Date): Promise<Check> {
  const freeze = freezeAt.toISOString();
  const [qr] = await q(
    `
    with b as (
      select b.id, btrim(b.order_number) as payload, count(*) over (partition by btrim(b.order_number)) as uses,
             coalesce(b.booking_cancel, 0) < 2 and coalesce(b.status, 1) = 1 and coalesce(b.is_paid, 1) = 1 as active
      from {s}.bookings b where nullif(btrim(b.order_number), '') is not null
    ), bc as (
      select tb.payload, count(*) as matches from ticketing.ticket_barcodes tb
      where tb.format = 'legacy_eventmie' and tb.instance = $1 and tb.active group by tb.payload
    ), own as (
      select r.legacy_id, tb.payload from ticketing.ticket_barcodes tb
      join legacy.ref r on r.new_id = tb.ticket_id and r.instance = $1 and r.entity = 'bookings'
      where tb.format = 'legacy_eventmie' and tb.instance = $1 and tb.active
    ), hits as (
      select b.id, b.uses, b.active, coalesce(bc.matches, 0) as matches, own.legacy_id is not null as own
      from b left join bc on bc.payload = b.payload
      left join own on own.legacy_id = b.id::text and own.payload = b.payload
    )
    select count(*) filter (where active and uses = 1) as vectors,
           count(*) filter (where active and uses = 1 and matches = 1 and own) as resolved,
           count(*) filter (where uses > 1) as duplicates_listed,
           count(*) filter (where uses > 1 and matches > 0) as duplicates_attached
    from hits`,
    [instance],
  );
  // yy1: a deterministic sample of active migrated tickets verifies against the org's public keys.
  const sample = await q(
    `select t.id, t.rev, b.payload, t.org_id
     from ticketing.tickets t
     join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity = 'booking_units'
     join ticketing.ticket_barcodes b on b.ticket_id = t.id and b.format = 'yy1' and b.active and b.rev = t.rev
     where t.status = 'active' order by md5(t.id::text) limit 200`,
    [instance],
  );
  const orgs = [...new Set(sample.map((s) => String(s.org_id)))];
  const keyRows = orgs.length
    ? await q(`select org_id, kid, public_key from ticketing.signing_keys where org_id = any($1::uuid[])`, [
        orgs,
      ])
    : [];
  let yy1Ok = 0;
  const yy1Bad: string[] = [];
  for (const s of sample) {
    const keys = new Map(
      keyRows
        .filter((k) => String(k.org_id) === String(s.org_id))
        .map((k) => [n(k.kid), Uint8Array.from(Buffer.from(String(k.public_key), 'base64'))]),
    );
    const v = await verifyTicketCode(String(s.payload), keys);
    if (v.ok && v.ticketId === s.id && v.rev === n(s.rev)) yy1Ok++;
    else yy1Bad.push(String(s.id));
  }
  const [tok] = await q(
    `
    select
      (select count(*) from {s}.personal_access_tokens p
         join legacy.ref u on u.instance = $1 and u.entity = 'users' and u.legacy_id = p.tokenable_id::text
        where p.tokenable_type ilike '%user' and lower(btrim(p.token)) ~ '^[0-9a-f]{64}$'
          and (p.expires_at is null or (p.expires_at at time zone s.platform_tz) > $2::timestamptz)) as pat_live,
      (select count(*) from {s}.personal_access_tokens p
         join auth.legacy_tokens l on l.instance = $1 and l.kind = 'personal_access' and l.legacy_id = p.id::text
         join legacy.ref u on u.instance = $1 and u.entity = 'users' and u.legacy_id = p.tokenable_id::text and u.new_id = l.user_id
        where l.token_hash = lower(btrim(p.token))
          -- live at this freeze: an earlier rehearsal (another freeze) may have carried more
          and (p.expires_at is null or (p.expires_at at time zone s.platform_tz) > $2::timestamptz)) as pat_carried,
      (select count(*) from {s}.users x join legacy.ref u on u.instance = $1 and u.entity = 'users' and u.legacy_id = x.id::text
        where length(btrim(coalesce(x.magic_login_token, ''))) >= 32
          and (x.magic_login_expires_at at time zone s.platform_tz) > $2::timestamptz) as magic_live,
      (select count(*) from {s}.users x
         join auth.legacy_tokens l on l.instance = $1 and l.kind = 'magic_login' and l.legacy_id = x.id::text
        where l.token_hash = encode(sha256(convert_to(btrim(x.magic_login_token), 'UTF8')), 'hex')
          and (x.magic_login_expires_at at time zone s.platform_tz) > $2::timestamptz) as magic_carried,
      (select count(*) from auth.accounts a
         join (select distinct new_id from legacy.ref where instance = $1 and entity = 'users') r on r.new_id = a.user_id
        where a.provider_id = 'credential' and a.password ~ '^\\$2[aby]\\$'
          and not exists (select 1 from legacy.credentials c where c.user_id = a.user_id and c.password_hash = a.password)) as bcrypt_foreign,
      (select count(*) from auth.accounts a
         join (select distinct new_id from legacy.ref where instance = $1 and entity = 'users') r on r.new_id = a.user_id
        cross join lateral unnest(string_to_array(substring(a.password from '^\\$yydual\\$[0-9]+\\$(.*)$'), '|')) h
        where a.provider_id = 'credential' and a.password like '$yydual$%'
          and not exists (select 1 from legacy.credentials c where c.user_id = a.user_id and c.password_hash = h
                          and (c.verified or c.has_paid))) as dual_foreign
    from legacy.instance_settings s where s.instance = $1`,
    [instance, freeze],
  ).catch((err: unknown) => [{ error: String(err) }]);
  const tokens = tok ?? {};
  const hasTokens = !('error' in tokens);
  const vectors = {
    legacyQr: {
      vectors: n(qr?.vectors),
      resolved: n(qr?.resolved),
      duplicatesListed: n(qr?.duplicates_listed),
      duplicatesAttached: n(qr?.duplicates_attached),
    },
    yy1: { sampled: sample.length, verified: yy1Ok, failed: yy1Bad.slice(0, 10) },
    accessTokens: hasTokens
      ? { live: n(tokens.pat_live), carried: n(tokens.pat_carried) }
      : { skipped: 'no table' },
    magicLinks: hasTokens
      ? { live: n(tokens.magic_live), carried: n(tokens.magic_carried) }
      : { skipped: 'no table' },
    passwords: hasTokens
      ? { foreignBcrypt: n(tokens.bcrypt_foreign), foreignDual: n(tokens.dual_foreign) }
      : { skipped: 'no table' },
    rememberMeAndSignedUrls: {
      pending:
        'Needs each instance APP_KEY and the owner vector corpus (audit step 8); verifiers ready in @yayatoh/auth/compat.',
    },
  };
  const pass =
    vectors.legacyQr.resolved === vectors.legacyQr.vectors &&
    vectors.legacyQr.duplicatesAttached === 0 &&
    yy1Ok === sample.length &&
    (!hasTokens ||
      (n(tokens.pat_live) === n(tokens.pat_carried) &&
        n(tokens.magic_live) === n(tokens.magic_carried) &&
        n(tokens.bcrypt_foreign) === 0 &&
        n(tokens.dual_foreign) === 0));
  return { id: 'V6', name: 'QR, token and password vectors (100% pass)', pass, details: vectors };
}

/** V7: the golden queries, legacy vs migrated, 0 differences. */
export async function v7Golden(q: Q, instance: string): Promise<Check> {
  const results = [];
  for (const g of GOLDEN_QUERIES) {
    const rows = await q(g.sql, [instance]).catch((err: unknown) => [
      { key: 'error', legacy: 0, migrated: String(err) },
    ]);
    const diffs = rows.filter((r) => n(r.legacy) !== n(r.migrated) || r.key === 'error');
    results.push({
      id: g.id,
      name: g.name,
      keys: rows.length,
      legacyTotal: rows.reduce((a, r) => a + n(r.legacy), 0),
      migratedTotal: rows.reduce((a, r) => a + n(r.migrated), 0),
      diffs: diffs.slice(0, 5),
      diffCount: diffs.length,
    });
  }
  return {
    id: 'V7',
    name: `Golden queries (${GOLDEN_QUERIES.length}) legacy vs migrated: 0 differences`,
    pass: results.every((r) => r.diffCount === 0),
    details: { queries: results },
  };
}

/** V8: the facade twin diff. Pending until the facade exists (the harness is ready). */
export function v8Facade(): Check {
  return {
    id: 'V8',
    name: 'Facade twin diff (0 unexplained) — pending: facade not built',
    pass: true,
    details: { pending: true, ...FACADE_STATUS },
  };
}

/** V9: every inventoried URL has its planned status (redirect loaded, or the page exists). */
export async function v9Urls(q: Q, instance: string): Promise<Check> {
  const rows = await q(
    `
    select i.kind, i.planned_status, count(*) as n,
           count(*) filter (where case
             when i.planned_status = 308 then exists (
               select 1 from marketplace.legacy_redirects r where r.host = i.host and r.source = i.path and r.target = i.target and r.status = 308)
               and case
                 when i.target ~ '^/events/' then exists (select 1 from events.events e where e.slug = split_part(i.target, '/', 3) and e.status = 'published')
                 when i.target ~ '^/venues/' then exists (select 1 from venues.venues v where v.slug = split_part(i.target, '/', 3) and v.directory_listed)
                 when i.target ~ '^/o/' then exists (select 1 from tenancy.organizations g where g.slug = split_part(i.target, '/', 3))
                 else false end
             when i.planned_status = 200 then
               not exists (select 1 from marketplace.legacy_redirects r where r.host = i.host and r.source = i.path)
               and case
                 when i.path ~ '^/events/' then exists (select 1 from events.events e where e.slug = split_part(i.path, '/', 3) and e.status = 'published')
                 when i.path ~ '^/venues/' then exists (select 1 from venues.venues v where v.slug = split_part(i.path, '/', 3) and v.directory_listed)
                 else false end
             else not exists (select 1 from marketplace.legacy_redirects r where r.host = i.host and r.source = i.path)
           end) as ok
    from legacy.url_inventory i where i.instance = $1
    group by 1, 2 order by 1, 2`,
    [instance],
  );
  const lines = rows.map((r) => ({ kind: r.kind, status: n(r.planned_status), urls: n(r.n), ok: n(r.ok) }));
  return {
    id: 'V9',
    name: 'URL inventory: every legacy URL has its planned status',
    pass: lines.every((l) => l.urls === l.ok),
    details: { lines, urls: lines.reduce((a, l) => a + l.urls, 0) },
  };
}

/**
 * Migrated tables and the columns the migration alone decides. Check-ins and the participation
 * projection are left out: door scans after a rehearsal change them legitimately.
 */
const MIGRATED_CHECKSUMS: Record<string, string> = {
  events: `select md5(string_agg(x, '' order by x)) from (select md5(concat_ws('|', e.id, e.slug, e.name, e.starts_at, e.ends_at, e.timezone, e.status, e.category, e.venue_id)) as x
             from events.events e join legacy.ref r on r.new_id = e.id and r.instance = $1 and r.entity = 'events') t`,
  ticket_types: `select md5(string_agg(x, '' order by x)) from (select md5(concat_ws('|', t.id, t.price_minor, t.quantity_total, t.quantity_sold, t.visibility)) as x
             from ticketing.ticket_types t join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity = 'tickets') t`,
  orders: `select md5(string_agg(x, '' order by x)) from (select md5(concat_ws('|', o.id, o.status, o.total_minor, o.fee_minor, o.discount_minor, o.currency, o.buyer_email, o.charge_model)) as x
             from orders.orders o join legacy.ref r on r.new_id = o.id and r.instance = $1 and r.entity = 'orders') t`,
  tickets: `select md5(string_agg(x, '' order by x)) from (select md5(concat_ws('|', t.id, t.status, t.void_reason, t.serial, t.short_code, t.seat_label, t.holder_email)) as x
             from ticketing.tickets t join legacy.ref r on r.new_id = t.id and r.instance = $1 and r.entity = 'booking_units') t`,
  legacy_settlements: `select md5(string_agg(x, '' order by x)) from (select md5(concat_ws('|', s.id, s.kind, s.currency, s.customer_paid_minor, s.commission_minor, s.organizer_earning_minor, s.open_minor)) as x
             from payments.legacy_settlements s where s.instance = $1
             -- rows in migrated orgs only (fixture orgs elsewhere in the database may carry a statement)
             and exists (select 1 from legacy.ref o where o.instance = $1 and o.entity = 'organizers' and o.new_id = s.org_id)) t`,
  event_seats: `select md5(string_agg(x, '' order by x)) from (select md5(concat_ws('|', s.seat_uuid, s.label, s.status, s.block_reason, s.ticket_id, s.ticket_type_id)) as x
             from seating.event_seats s join legacy.ref r on r.new_id = s.event_id and r.instance = $1 and r.entity = 'events') t`,
  venues: `select md5(string_agg(x, '' order by x)) from (select md5(concat_ws('|', v.id, v.slug, v.name, v.timezone, v.latitude)) as x
             from venues.venues v join legacy.ref r on r.new_id = v.id and r.instance = $1 and r.entity = 'venues') t`,
};

/**
 * V10: checksums. Every staging table's content (what was loaded from the dump) and each migrated
 * table's stable columns are hashed. The same input must give the same output: a run whose staging
 * checksums equal an earlier successful run's must reproduce that run's migrated checksums exactly
 * (a run on new input records a new baseline).
 */
export async function v10Checksums(
  q: Q,
  instance: string,
  runId: number | null,
  stagingSchema: string,
): Promise<Check> {
  const tables = await q(
    `select table_name from information_schema.tables where table_schema = $1 and table_name not like '\\_%' order by 1`,
    [stagingSchema],
  );
  const staging: Record<string, string> = {};
  for (const t of tables) {
    const name = String(t.table_name);
    const [r] = await q(
      `select coalesce(md5(string_agg(h, '' order by h)), '') as c from (select md5(x::text) as h from {s}."${name.replace(/"/g, '""')}" x) y`,
    );
    staging[name] = String(r?.c ?? '');
  }
  const migrated: Record<string, string> = {};
  for (const [name, text] of Object.entries(MIGRATED_CHECKSUMS)) {
    const [r] = await q(text, [instance]).catch(() => [{}]);
    migrated[name] = String((r && Object.values(r)[0]) ?? '');
  }
  // The baseline: the latest earlier successful run of this instance that read exactly the same
  // staging content (same dump, nothing edited in between).
  const earlier = runId
    ? await q(
        `select id, report -> 'checks' as checks from legacy.runs
         where instance = $1 and id < $2 and status = 'succeeded' order by id desc limit 20`,
        [instance, runId],
      )
    : [];
  type V10 = { staging?: Record<string, string>; migrated?: Record<string, string> };
  const v10Of = (r: Row) =>
    (r.checks as { id: string; details: V10 }[] | null)?.find((c) => c.id === 'V10')?.details;
  const same = (a: Record<string, string> | undefined) =>
    !!a &&
    Object.keys(staging).length === Object.keys(a).length &&
    Object.entries(staging).every(([k, v]) => a[k] === v);
  const prev = earlier.find((r) => same(v10Of(r)?.staging));
  const prevV10 = prev ? v10Of(prev) : undefined;
  const changed: string[] = [];
  if (prevV10) {
    for (const [k, v] of Object.entries(staging))
      if (prevV10.staging?.[k] !== undefined && prevV10.staging[k] !== v) changed.push(`staging.${k}`);
    for (const [k, v] of Object.entries(migrated))
      if (prevV10.migrated?.[k] !== undefined && prevV10.migrated[k] !== v) changed.push(`migrated.${k}`);
  }
  return {
    id: 'V10',
    name: 'Checksums per table (reproduced by a rerun on the same dump)',
    pass: changed.length === 0,
    details: { baselineRun: prev ? n(prev.id) : null, changed, staging, migrated },
  };
}
