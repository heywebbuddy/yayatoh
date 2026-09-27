import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTicketCommand } from '@yayatoh/checkin';
import { closePools } from '@yayatoh/db';
import { migratorSql } from '@yayatoh/db/migration';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { orderByManageToken } from '@yayatoh/orders';
import { ports } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoHandles } from '../src/demo.ts';
import { detUuid, emailNorm, legacyKey, shortCode } from '../src/ids.ts';
import { type RunResult, revalidate, runMigration } from '../src/run.ts';
import { DEMO, generateDumpFile, SYNTH_PASSWORD_HASH } from '../src/synth/generate.ts';
import { checkinInstant, wallToInstant } from '../src/time.ts';

const dir = mkdtempSync(join(tmpdir(), 'legacy-int-'));
const dumps = { yay: join(dir, 'yay.sql'), abc: join(dir, 'abc.sql') };
let first: { yay: RunResult; abc: RunResult };
const quiet = () => {};

const sql = () => migratorSql();
async function one<T>(q: Promise<T[]>): Promise<T> {
  const [r] = await q;
  if (!r) throw new Error('no row');
  return r;
}
const check = (r: RunResult, id: string) => r.report.checks.find((c) => c.id === id);

/** A fingerprint of every migrated table: ids and the fields a rerun must not change. */
async function fingerprint() {
  const tables = [
    'auth.users',
    'tenancy.organizations',
    'tenancy.memberships',
    'events.events',
    'ticketing.ticket_types',
    'orders.orders',
    'orders.order_items',
    'ticketing.tickets',
    'attendees.attendees',
    'crm.contacts',
    'orders.refunds',
    'checkin.admissions',
    'checkin.scans',
    'payments.legacy_settlements',
    'ticketing.ticket_barcodes',
    'tenancy.org_relationships',
  ];
  const out: Record<string, string> = {};
  for (const t of tables) {
    const [r] = await sql().unsafe(
      `select count(*)::text || ':' || coalesce(md5(string_agg(id::text, ',' order by id)), '') as f from ${t}`,
    );
    out[t] = String((r as { f: string }).f);
  }
  const [s] =
    await sql()`select md5(string_agg(serial || short_code || status, ',' order by id)) as f from ticketing.tickets`;
  out['tickets.fields'] = String(s?.f);
  return out;
}

beforeAll(async () => {
  await generateDumpFile(dumps.yay, { instance: 'yay', scale: 'small', demo: true });
  await generateDumpFile(dumps.abc, { instance: 'abc', scale: 'small' });
  first = {
    yay: await runMigration({ instance: 'yay', mode: 'rehearsal', dump: dumps.yay, log: quiet }),
    abc: await runMigration({ instance: 'abc', mode: 'rehearsal', dump: dumps.abc, log: quiet }),
  };
}, 180_000);

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePools();
});

describe('legacy migration — runs and reports', () => {
  it('both instances pass every check with nothing quarantined', () => {
    for (const r of [first.yay, first.abc]) {
      expect(r.report.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual([]);
      expect(r.report.quarantine.filter((q) => q.quarantined > 0)).toEqual([]);
      expect(r.pass).toBe(true);
      expect(r.summary).toContain('PASS');
      expect(Object.keys(r.report.timingsMs)).toEqual(
        expect.arrayContaining([
          'load',
          't1_identity',
          't4_commerce',
          't5_checkins',
          'issue_codes',
          'validate',
        ]),
      );
    }
  });

  it('refuses a cutover run without its explicit confirmation', async () => {
    await expect(runMigration({ instance: 'yay', mode: 'cutover', log: quiet })).rejects.toThrow(
      /LEGACY_CUTOVER_CONFIRM=yay/,
    );
  });

  it('keeps the staging and control schemas away from app_user and platform_reader', async () => {
    const r = await one(
      sql()<{ app: boolean; reader: boolean; app_legacy: boolean }[]>`
        select has_schema_privilege('app_user', 'legacy_yay', 'usage') as app,
               has_schema_privilege('platform_reader', 'legacy_yay', 'usage') as reader,
               has_schema_privilege('app_user', 'legacy', 'usage') as app_legacy`,
    );
    expect(r).toEqual({ app: false, reader: false, app_legacy: false });
    expect(check(first.yay, 'V11')?.details).toMatchObject({
      notForced: [],
      probe: { staging: 'denied', control: 'denied', other: 0 },
    });
  });
});

describe('SQL twins agree with the TypeScript rules', () => {
  it('det_uuid, email_norm, short_code, checkin_instant and local_kind', async () => {
    const at = '2024-05-01T14:00:00.123Z';
    const r = await one(
      sql()<Record<string, string>[]>`
        select legacy.det_uuid(${at}::timestamptz, ${legacyKey('yay', 'bookings', 42)})::text as id,
               legacy.det_uuid(null, 'k')::text as id_null,
               legacy.email_norm(${'  ＡＤＡ@Example.COM '}) as email,
               legacy.short_code(${'0190f2a0-0000-7000-8000-000000000001'}::uuid, 0) as code,
               legacy.short_code(${'0190f2a0-0000-7000-8000-000000000001'}::uuid, 3) as code3,
               legacy.checkin_instant('2026-06-10', '01:30:00', 'America/New_York')::text as ci,
               legacy.local_kind('2025-11-02 01:30:00', 'America/New_York') as fold,
               legacy.local_kind('2026-03-08 02:30:00', 'America/New_York') as gap,
               legacy.local_kind('2026-07-04 19:30:00', 'America/New_York') as ok,
               ('2026-03-08 02:30:00'::timestamp at time zone 'America/New_York')::text as gap_instant`,
    );
    expect(r.id).toBe(detUuid(new Date(at), legacyKey('yay', 'bookings', 42)));
    expect(r.id_null).toBe(detUuid(null, 'k'));
    expect(r.email).toBe(emailNorm('  ＡＤＡ@Example.COM '));
    expect(r.code).toBe(shortCode('0190f2a0-0000-7000-8000-000000000001'));
    expect(r.code3).toBe(shortCode('0190f2a0-0000-7000-8000-000000000001', 3));
    expect(new Date(r.ci as string).getTime()).toBe(
      checkinInstant('2026-06-10', '01:30:00', 'America/New_York'),
    );
    expect([r.fold, r.gap, r.ok]).toEqual(['fold', 'gap', 'ok']);
    expect(new Date(r.gap_instant as string).getTime()).toBe(
      wallToInstant('2026-03-08 02:30:00', 'America/New_York').ms,
    );
  });
});

describe('T1 identity', () => {
  it('merges the same email across instances into one user (normalized), with refs from both', async () => {
    const r = await one(
      sql()<{ users: number; refs: number; instances: string }[]>`
        select count(distinct u.id)::int as users, count(*)::int as refs, string_agg(distinct r.instance, ',' order by r.instance) as instances
        from auth.users u join legacy.ref r on r.new_id = u.id and r.entity = 'users'
        where u.email = 'member.1@example.com'`,
    );
    expect(r).toEqual({ users: 1, refs: 2, instances: 'abc,yay' });
    expect(check(first.abc, 'V5')?.details).toMatchObject({ prehijack_violations: 0 });
    const v5 = check(first.abc, 'V5')?.details as { merged_identities: number } | undefined;
    expect(v5?.merged_identities).toBeGreaterThan(0);
  });

  it('carries bcrypt credentials, never creates staff, and lists legacy admins', async () => {
    const r = await one(
      sql()<{ creds: number; bcrypt: number; staff: number }[]>`
        select (select count(distinct a.id)::int from auth.accounts a join legacy.ref r on r.new_id = a.user_id and r.entity = 'users') as creds,
               (select count(*)::int from auth.accounts where password = ${SYNTH_PASSWORD_HASH}) as bcrypt,
               (select count(*)::int from platform.staff s join legacy.ref r on r.new_id = s.user_id and r.entity = 'users') as staff`,
    );
    expect(r.creds).toBeGreaterThan(50);
    expect(r.bcrypt).toBe(r.creds);
    expect(r.staff).toBe(0);
    expect(first.yay.report.exceptions.legacy_admin).toBe(1);
  });

  it('pre-hijack guard: a never-verified, never-paid twin’s credential is not carried into the merged account', async () => {
    // Give the unverified abc twin its own (attacker's) hash, and a yay-only unverified account a hash too.
    const email = 'member.4@example.com';
    await sql()`update legacy_abc.users set password = '$2y$10$attackerattackerattackeOattackerattackerattackerattac' where lower(btrim(email)) = ${email}`;
    const twin = await one(
      sql()<
        { verified: boolean }[]
      >`select email_verified_at is not null as verified from legacy_abc.users where lower(btrim(email)) = ${email}`,
    );
    expect(twin.verified).toBe(false);
    const r = await runMigration({ instance: 'abc', mode: 'rehearsal', log: quiet });
    expect(r.pass).toBe(true);
    const acct = await one(
      sql()<
        { password: string }[]
      >`select a.password from auth.accounts a join auth.users u on u.id = a.user_id where u.email = ${email}`,
    );
    expect(acct.password).toBe(SYNTH_PASSWORD_HASH);
    const [ex] =
      await sql()`select 1 from legacy.exceptions where run_id = ${r.runId} and kind = 'credential_skipped_prehijack'`;
    expect(ex).toBeDefined();
  });

  it('never overwrites a password set on the new platform', async () => {
    const user = await one(
      sql()<{ id: string }[]>`select id from auth.users where email = 'member.2@example.com'`,
    );
    await sql()`update auth.accounts set password = '$argon2id$v=19$m=19456,t=2,p=1$new-platform' where user_id = ${user.id}`;
    await runMigration({ instance: 'yay', mode: 'rehearsal', log: quiet });
    const acct = await one(
      sql()<{ password: string }[]>`select password from auth.accounts where user_id = ${user.id}`,
    );
    expect(acct.password).toMatch(/^\$argon2id\$/);
  });
});

describe('T2 orgs', () => {
  it('makes one org per organizer with its owner, sub-account roles and Stripe account', async () => {
    const demo = await one(
      sql()<{ id: string; slug: string; legacy_instance: string; owner: string }[]>`
        select o.id, o.slug, o.legacy_instance,
               (select u.email from tenancy.memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id and m.role = 'owner') as owner
        from tenancy.organizations o where o.name = ${DEMO.organisation}`,
    );
    expect(demo).toMatchObject({
      slug: 'lakeshore-jazz-society',
      legacy_instance: 'yay',
      owner: DEMO.ownerEmail,
    });
    const roles = await sql()<
      { role: string }[]
    >`select role from tenancy.memberships where org_id = ${demo.id} order by role`;
    expect(roles.map((r) => r.role)).toEqual(['manager', 'owner', 'scanner']);
    const eventRoles = await sql()<
      { role: string }[]
    >`select distinct role from events.event_role_assignments where org_id = ${demo.id} order by role`;
    expect(eventRoles.map((r) => r.role)).toEqual(['door_staff', 'event_manager']);
    const acct = await one(
      sql()<
        { account_id: string; charges_enabled: boolean }[]
      >`select account_id, charges_enabled from payments.payment_accounts where org_id = ${demo.id}`,
    );
    expect(acct).toEqual({ account_id: 'acct_SYNTHDEMO0001', charges_enabled: false });
    const domain = await one(
      sql()<
        { hostname: string; status: string }[]
      >`select hostname, status from tenancy.org_domains where org_id = ${demo.id} and managed`,
    );
    expect(domain.hostname).toBe('lakeshore-jazz-society.yayatoh.events');
  });

  it('makes abc the parent ABC org owning abc.yayatoh.com, with every other abc organizer a host_affiliate child', async () => {
    const abc = await one(
      sql()<{ id: string; slug: string; children: number; organizers: number; admins: string }[]>`
        select o.id, o.slug,
               (select count(*)::int from tenancy.org_relationships r where r.org_id = o.id and r.kind = 'host_affiliate') as children,
               (select count(*)::int from legacy_abc.users where role_id = 3) as organizers,
               (select string_agg(m.role, ',') from tenancy.memberships m where m.org_id = o.id) as admins
        from tenancy.organizations o
        join legacy.ref r on r.new_id = o.id and r.instance = 'abc' and r.entity = 'organizers' and r.legacy_id = 'parent'`,
    );
    expect(abc.slug).toBe('abc');
    expect(abc.children).toBe(abc.organizers);
    expect(abc.admins).toBe('owner');
    const d = await one(
      sql()<
        { status: string; managed: boolean }[]
      >`select status, managed from tenancy.org_domains where hostname = 'abc.yayatoh.com'`,
    );
    expect(d).toEqual({ status: 'pending_dns', managed: false });
    // abc admins' own events belong to ABC.
    const [e] = await sql()`
      select 1 from legacy_abc.events le join legacy.ref r on r.instance = 'abc' and r.entity = 'events' and r.legacy_id = le.id::text
      join events.events e on e.id = r.new_id where le.user_id = 1 and e.org_id = ${abc.id}`;
    expect(e).toBeDefined();
  });
});

describe('T3/T4 catalog and commerce', () => {
  it('keeps event instants in the platform zone and renders them in the venue zone; DST folds and gaps logged', async () => {
    const r = await one(
      sql()<{ timezone: string; starts: string; local: string }[]>`
        select e.timezone, e.starts_at::text as starts, to_char(e.starts_at at time zone e.timezone, 'YYYY-MM-DD HH24:MI') as local
        from events.events e join legacy.ref r on r.new_id = e.id and r.instance = 'yay' and r.entity = 'events'
        join legacy_yay.events le on le.id::text = r.legacy_id where le.title = ${DEMO.pastEventTitle}`,
    );
    // 18:30 New York wall clock (platform), rendered in Chicago (venue): 17:30.
    expect(r).toEqual({
      timezone: 'America/Chicago',
      starts: '2026-04-18 22:30:00+00',
      local: '2026-04-18 17:30',
    });
    expect(first.yay.report.exceptions).toMatchObject({ dst_fold: 1, dst_gap: 1 });
    expect(first.abc.report.exceptions).toMatchObject({ dst_fold: 1 });
  });

  it('turns a multi-row checkout into one order with one ticket and attendee per person', async () => {
    const r = await one(
      sql()<
        { rows: number; tickets: number; attendees: number; orders: number; total: string; net: string }[]
      >`
        with b as (select common_order, event_id, customer_id, count(*) as n, sum(quantity) as q, sum(round(net_price * 100)) as net
                   from legacy_yay.bookings where distributed_from_booking_id is null group by 1, 2, 3 having count(*) > 1 limit 1)
        select b.n::int as rows, b.q::int as tickets, b.net::text as net,
               (select count(*)::int from ticketing.tickets t where t.order_id = o.id) as tickets_new,
               (select count(*)::int from attendees.attendees a join ticketing.tickets t on t.id = a.ticket_id where t.order_id = o.id) as attendees,
               1 as orders, o.total_minor::text as total
        from b join legacy.ref r on r.instance = 'yay' and r.entity = 'orders' and r.legacy_id = b.common_order || '|' || b.event_id || '|' || b.customer_id
        join orders.orders o on o.id = r.new_id`,
    );
    expect(r.total).toBe(r.net);
    expect((r as unknown as { tickets_new: number }).tickets_new).toBe(r.tickets);
    expect(r.attendees).toBe(r.tickets);
  });

  it('maps a distributable row to quantity N and hand-ons to the new holder of one unit', async () => {
    const h = await one(
      sql()<{ holder_email: string; customer_email: string; order_id: string; parent_order: string }[]>`
        select t.holder_email, lower(c.customer_email) as customer_email, t.order_id,
               (select r2.new_id::text from legacy.ref r2 where r2.instance = 'yay' and r2.entity = 'orders'
                  and r2.legacy_id = p.common_order || '|' || p.event_id || '|' || p.customer_id) as parent_order
        from legacy_yay.bookings c
        join legacy_yay.bookings p on p.id = c.distributed_from_booking_id
        join legacy.ref r on r.instance = 'yay' and r.entity = 'bookings' and r.legacy_id = c.id::text
        join ticketing.tickets t on t.id = r.new_id
        order by c.id limit 1`,
    );
    expect(h.holder_email).toBe(h.customer_email);
    expect(h.order_id).toBe(h.parent_order);
  });

  it('uses the attendee email from attendees.address when valid, else the buyer’s', async () => {
    const rows = await sql()<{ address: string; holder_email: string; buyer: string }[]>`
      select a.address, t.holder_email, o.buyer_email as buyer
      from legacy_yay.attendees a
      join legacy.ref r on r.instance = 'yay' and r.entity = 'booking_units' and r.legacy_id = a.booking_id || ':1'
      join ticketing.tickets t on t.id = r.new_id join orders.orders o on o.id = t.order_id
      join legacy_yay.bookings b on b.id = a.booking_id
      where b.quantity = 1 and b.distributed_from_booking_id is null`;
    expect(rows.length).toBeGreaterThan(20);
    const invalid = rows.filter((x) => x.address === 'N/A');
    expect(invalid.length).toBeGreaterThan(0);
    for (const x of invalid) expect(x.holder_email).toBe(x.buyer);
    for (const x of rows.filter((y) => y.address.includes('@')))
      expect(x.holder_email).toBe(emailNorm(x.address));
  });

  it('records charge models, direct charges on the connected account, refunds and statuses', async () => {
    const models = await sql()<
      { charge_model: string; funds_flow: string; provider: string | null; n: number }[]
    >`
      select charge_model, funds_flow, provider, count(*)::int as n from orders.orders where created_via = 'legacy'
      group by 1, 2, 3 order by 1, 2`;
    const by = (m: string) => models.filter((x) => x.charge_model === m);
    expect(
      by('legacy_direct_connected').every((x) => x.funds_flow === 'organizer_mor' && x.provider === 'stripe'),
    ).toBe(true);
    expect(
      by('legacy_platform').every((x) => x.funds_flow === 'platform_mor' && x.provider === 'stripe'),
    ).toBe(true);
    expect(by('paypal').every((x) => x.provider === 'paypal')).toBe(true);
    expect(by('offline').every((x) => x.provider === null)).toBe(true);
    const refunds = await one(
      sql()<{ n: number; bad: number }[]>`
        select count(*)::int as n,
               count(*) filter (where f.status <> 'succeeded' or o.status not in ('refunded', 'partially_refunded'))::int as bad
        from orders.refunds f join orders.orders o on o.id = f.order_id where o.created_via = 'legacy'`,
    );
    expect(refunds.n).toBeGreaterThan(0);
    expect(refunds.bad).toBe(0);
    const statuses = check(first.yay, 'V3')?.details as { orders: Record<string, number> };
    expect(Object.keys(statuses.orders)).toEqual(
      expect.arrayContaining(['paid', 'refunded', 'cancelled', 'awaiting_payment']),
    );
  });

  it('turns commissions into legacy statements and owner-signed opening balances', async () => {
    const r = await one(
      sql()<
        { statements: number; openings: number; pending: number; open_sum: string; opening_sum: string }[]
      >`
        select count(*) filter (where kind = 'event_statement')::int as statements,
               count(*) filter (where kind = 'opening_balance')::int as openings,
               count(*) filter (where kind = 'opening_balance' and status = 'pending_signoff')::int as pending,
               sum(open_minor) filter (where kind = 'event_statement')::text as open_sum,
               sum(open_minor) filter (where kind = 'opening_balance')::text as opening_sum
        from payments.legacy_settlements`,
    );
    expect(r.statements).toBeGreaterThan(0);
    expect(r.openings).toBe(r.pending);
    expect(r.opening_sum).toBe(r.open_sum);
  });

  it('issues a manage token and signed codes: the buyer’s order page loads with a QR per ticket', async () => {
    const h = await demoHandles();
    const order = await orderByManageToken(h.buyer.manageToken);
    expect(order?.buyerEmail).toBe(DEMO.buyerEmail);
    expect(order?.tickets.length).toBe(2);
    for (const t of order?.tickets ?? []) expect(t.code).toMatch(/^YY1/);
    const [unissued] =
      await sql()`select 1 from orders.orders where manage_token_hash like 'legacy-unissued:%'`;
    expect(unissued).toBeUndefined();
  });
});

describe('T5 check-ins and the legacy QR', () => {
  it('imports check-ins as admissions plus legacy scans, one per ticket per day', async () => {
    const r = await one(
      sql()<{ scans: number; kinds: string; dup: number }[]>`
        select count(*)::int as scans, string_agg(distinct code_kind || '/' || result, ',') as kinds,
               (select count(*)::int from (select ticket_id, day from checkin.admissions group by 1, 2 having count(*) > 1) x) as dup
        from checkin.scans where client_scan_id like 'legacy:%'`,
    );
    expect(r.scans).toBeGreaterThan(10);
    expect(r.kinds).toBe('legacy/admitted');
    expect(r.dup).toBe(0);
  });

  it('a migrated ticket scans with its legacy QR payload (raw or JSON) and its yy1 code', async () => {
    const h = await demoHandles();
    const org = await one(
      sql()<{ id: string }[]>`select id from tenancy.organizations where slug = ${h.org.slug}`,
    );
    const ev = await one(sql()<{ id: string }[]>`select id from events.events where slug = ${h.weekly.slug}`);
    const owner = await one(
      sql()<{ id: string }[]>`select id from auth.users where email = ${DEMO.ownerEmail}`,
    );
    const ctx = () => createCtx({ orgId: org.id, actor: { type: 'user', userId: owner.id } });
    const scan = h.scans['mobile-375'];
    if (!scan) throw new Error('no scan handle');
    const a = await executeCommand(
      scanTicketCommand,
      { eventId: ev.id, code: scan.legacyCode },
      ctx(),
      ports,
    );
    expect(a.result).toBe('admitted');
    expect(a.ticket?.holderName).toBe(scan.name);
    const b = await executeCommand(
      scanTicketCommand,
      { eventId: ev.id, code: JSON.stringify({ order_number: scan.legacyCode }) },
      ctx(),
      ports,
    );
    expect(b.result).toBe('duplicate');
    const [s] =
      await sql()`select code_kind from checkin.scans where admission_id = ${a.admissionId} and client_scan_id is null`;
    expect(s?.code_kind).toBe('legacy');
    // A duplicated order_number is not attached (owner review) and does not admit anyone.
    const dup = await one(sql()<{ order_number: string }[]>`
      select order_number from legacy_yay.bookings group by order_number having count(*) > 1 limit 1`);
    const [bc] = await sql()`select 1 from ticketing.ticket_barcodes where payload = ${dup.order_number}`;
    expect(bc).toBeUndefined();
    expect(first.yay.report.exceptions.duplicate_order_number).toBeGreaterThan(1);
  });
});

describe('idempotence', () => {
  it('a rerun on the same dump produces identical ids and no duplicates', async () => {
    const before = await fingerprint();
    const again = await runMigration({ instance: 'yay', mode: 'rehearsal', dump: dumps.yay, log: quiet });
    expect(again.pass).toBe(true);
    expect(await fingerprint()).toEqual(before);
  });
});

describe('quarantine rules', () => {
  it('fails the run when a money or ticket row cannot be migrated (zero allowed)', async () => {
    const b = await one(
      sql()<
        { id: number; event_id: number }[]
      >`select id, event_id from legacy_abc.bookings order by id desc limit 1`,
    );
    await sql()`update legacy_abc.bookings set event_id = 999999 where id = ${b.id}`;
    try {
      const r = await runMigration({ instance: 'abc', mode: 'rehearsal', log: quiet });
      expect(r.pass).toBe(false);
      const line = r.report.quarantine.find((q) => q.table === 'bookings');
      expect(line).toMatchObject({ quarantined: 1, limitPct: 0, pass: false });
      expect(r.summary).toContain('FAIL');
    } finally {
      await sql()`update legacy_abc.bookings set event_id = ${b.event_id} where id = ${b.id}`;
    }
    expect((await runMigration({ instance: 'abc', mode: 'rehearsal', log: quiet })).pass).toBe(true);
  });

  it('lets a content table quarantine up to 0.5% (invalid JSON) and fails above it', async () => {
    // 400 more (content-only) users so one bad value is 0.2%.
    await sql()`
      insert into legacy_abc.users (id, name, email, password, role_id, created_at)
      select 100000 + g, 'Filler ' || g, 'filler.' || g || '@example.org', ${SYNTH_PASSWORD_HASH}, 2, '2024-01-01 10:00:00'
      from generate_series(1, 400) g`;
    try {
      await sql()`update legacy_abc.users set social_links = '{"twitter": @broken' where id = 100001`;
      const ok = await runMigration({ instance: 'abc', mode: 'rehearsal', log: quiet });
      expect(ok.report.quarantine.find((q) => q.table === 'users')).toMatchObject({
        quarantined: 1,
        pass: true,
      });
      expect(ok.pass).toBe(true);
      await sql()`update legacy_abc.users set social_links = '[' where id between 100002 and 100004`;
      const bad = await runMigration({ instance: 'abc', mode: 'rehearsal', log: quiet });
      expect(bad.report.quarantine.find((q) => q.table === 'users')).toMatchObject({
        quarantined: 4,
        pass: false,
      });
      expect(bad.pass).toBe(false);
    } finally {
      await sql()`update legacy_abc.users set social_links = null where id > 100000`;
    }
  });
});

describe('every validation catches a planted defect', () => {
  const failing = async (id: string) => {
    const r = await revalidate('yay');
    return { pass: r.pass, check: r.report.checks.find((c) => c.id === id)?.pass };
  };

  it('starts from a passing state', async () => {
    expect((await revalidate('yay')).pass).toBe(true);
  });

  it('V1 row counts: a legacy booking that was not migrated', async () => {
    await sql()`
      insert into legacy_yay.bookings (id, customer_id, event_id, ticket_id, quantity, price, net_price, status, common_order, transaction_id,
                                       event_title, ticket_title, ticket_price, event_category, customer_name, customer_email, payment_type, is_paid,
                                       is_bulk, is_distributable, checked_in, event_repetitive)
      select 900001, customer_id, event_id, ticket_id, 1, 0, 0, 1, 'planted', 0, event_title, ticket_title, 0, '', customer_name, customer_email,
             'offline', 1, 0, 0, 0, 0 from legacy_yay.bookings order by id limit 1`;
    try {
      expect(await failing('V1')).toEqual({ pass: false, check: false });
    } finally {
      await sql()`delete from legacy_yay.bookings where id = 900001`;
    }
  });

  it('V2 money: one cent off an order', async () => {
    const o = await one(sql()<{ id: string }[]>`
      select o.id from orders.orders o join legacy.ref r on r.new_id = o.id and r.instance = 'yay' and r.entity = 'orders'
      where o.total_minor > 0 order by o.id limit 1`);
    await sql()`update orders.orders set total_minor = total_minor + 1, subtotal_minor = subtotal_minor + 1 where id = ${o.id}`;
    try {
      expect(await failing('V2')).toEqual({ pass: false, check: false });
    } finally {
      await sql()`update orders.orders set total_minor = total_minor - 1, subtotal_minor = subtotal_minor - 1 where id = ${o.id}`;
    }
  });

  it('V3 statuses: a refunded ticket made active', async () => {
    const t = await one(sql()<{ id: string; void_reason: string }[]>`
      select t.id, t.void_reason from ticketing.tickets t join legacy.ref r on r.new_id = t.id and r.instance = 'yay' and r.entity = 'booking_units'
      where t.status = 'void' order by t.id limit 1`);
    await sql()`update ticketing.tickets set status = 'active', void_reason = null where id = ${t.id}`;
    try {
      expect(await failing('V3')).toEqual({ pass: false, check: false });
    } finally {
      await sql()`update ticketing.tickets set status = 'void', void_reason = ${t.void_reason} where id = ${t.id}`;
    }
  });

  it('V4 orphans: a ticket whose order item is gone', async () => {
    const t = await one(sql()<{ order_item_id: string }[]>`
      select t.order_item_id from ticketing.tickets t join legacy.ref r on r.new_id = t.id and r.instance = 'yay' and r.entity = 'booking_units'
      order by t.id limit 1`);
    const [item] = await sql()`select * from orders.order_items where id = ${t.order_item_id}`;
    await sql()`delete from orders.order_items where id = ${t.order_item_id}`;
    try {
      expect(await failing('V4')).toEqual({ pass: false, check: false });
    } finally {
      await sql()`insert into orders.order_items ${sql()(item as Record<string, unknown>)}`;
    }
  });

  it('V5 users: an identity split in two', async () => {
    await sql()`insert into auth.users (id, name, email) values ('01900000-0000-7000-8000-00000000d0d0', 'Split', 'split.twin@example.org')`;
    await sql()`insert into legacy.ref (instance, entity, legacy_id, new_id) values ('yay', 'users', 'planted', '01900000-0000-7000-8000-00000000d0d0')`;
    try {
      expect(await failing('V5')).toEqual({ pass: false, check: false });
    } finally {
      await sql()`delete from legacy.ref where legacy_id = 'planted'`;
      await sql()`delete from auth.users where id = '01900000-0000-7000-8000-00000000d0d0'`;
    }
  });

  it('V11 RLS: a tenant table without FORCE', async () => {
    await sql()`alter table orders.refunds no force row level security`;
    try {
      const r = await failing('V11');
      expect(r).toEqual({ pass: false, check: false });
    } finally {
      await sql()`alter table orders.refunds force row level security`;
    }
  });

  it('V12 time: an event shifted by an hour', async () => {
    const e = await one(sql()<{ id: string }[]>`
      select e.id from events.events e join legacy.ref r on r.new_id = e.id and r.instance = 'yay' and r.entity = 'events'
      join legacy_yay.events le on le.id::text = r.legacy_id where le.title = ${DEMO.pastEventTitle}`);
    await sql()`update events.events set starts_at = starts_at + interval '1 hour' where id = ${e.id}`;
    try {
      expect(await failing('V12')).toEqual({ pass: false, check: false });
    } finally {
      await sql()`update events.events set starts_at = starts_at - interval '1 hour' where id = ${e.id}`;
    }
  });

  it('ends in a passing state again', async () => {
    expect((await revalidate('yay')).pass).toBe(true);
  });
});
