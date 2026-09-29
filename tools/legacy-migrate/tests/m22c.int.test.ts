import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeLegacyMagicLink, verifyLegacyAccessToken, verifyPassword } from '@yayatoh/auth';
import { closePools, withTenant } from '@yayatoh/db';
import { migratorSql } from '@yayatoh/db/migration';
import { createCtx } from '@yayatoh/kernel';
import { matchLegacyRedirect } from '@yayatoh/marketplace';
import { createNotifier } from '@yayatoh/notifications';
import { refundMailer, ticketMailer } from '@yayatoh/orders';
import {
  consumeEvent,
  defineSubscriber,
  localKeyVault,
  type PublishedEvent,
  type Subscriber,
  setKeyVault,
  subscribes,
} from '@yayatoh/platform';
import { sql as dsql } from 'drizzle-orm';
// The testing package registers the composition root (key vault, ports) the transforms use.
import '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { legacySeatUuid } from '../src/ids.ts';
import { orderLinkReport } from '../src/order-links.ts';
import { type RunResult, revalidate, runMigration } from '../src/run.ts';
import { CM_PER_PX } from '../src/seatchart.ts';
import { DEMO, generateDumpFile, SYNTH_PASSWORD_HASH, type SynthSummary } from '../src/synth/generate.ts';

// Both legacy suites migrate the same synthetic orgs (deterministic ids) into the shared test
// database, so they seal and open those orgs' ticket keys under one fixed test vault, whichever
// suite runs first (@yayatoh/testing registers a random vault per file).
setKeyVault(localKeyVault('5e'.repeat(32)));

/**
 * M2.2c on synthetic data: the T3 remainder (venues, categories, series, seat charts), T6
 * (consents, push tokens, the order-link plan), T8 (tokens, magic links, resets, dual-hash grace),
 * T9 (history projections and replayed events), the URL inventory and V6–V10. The freeze is the
 * synthetic dataset's "today" so live tokens exist.
 */
const FREEZE = new Date('2026-09-01T12:00:00Z');
const ABC_PASSWORD_HASH = '$2y$10$UyCHLqBjuFMmuEfkAAMwBu0ykRHf7PNRIJSiN3u0fXS8Sxwz8fmw6'; // 'synthetic-password-abc'
const dir = mkdtempSync(join(tmpdir(), 'legacy-m22c-'));
const dumps = { yay: join(dir, 'yay.sql'), abc: join(dir, 'abc.sql') };
const facts: Partial<Record<'yay' | 'abc', SynthSummary>> = {};
let first: { yay: RunResult; abc: RunResult };
const quiet = () => {};
const sql = () => migratorSql();
async function one<T>(q: Promise<T[]>): Promise<T> {
  const [r] = await q;
  if (!r) throw new Error('no row');
  return r;
}
const check = (r: RunResult, id: string) => r.report.checks.find((c) => c.id === id);
/** A run passed; on failure, name the checks that failed (and their details). */
function expectPass(r: RunResult) {
  const failed = r.report.checks.filter((c) => !c.pass);
  expect(failed.map((c) => `${c.id}: ${JSON.stringify(c.details).slice(0, 1500)}`)).toEqual([]);
  expect(r.report.quarantine.filter((q) => !q.pass)).toEqual([]);
  expect(r.pass).toBe(true);
}
const run = (instance: 'yay' | 'abc', dump?: string) =>
  runMigration({
    instance,
    mode: 'rehearsal',
    dump,
    freezeAt: FREEZE,
    log: quiet,
    extraHosts: instance === 'yay' ? ['yayatoh.localhost'] : [],
  });

beforeAll(async () => {
  facts.yay = await generateDumpFile(dumps.yay, { instance: 'yay', scale: 'small', demo: true });
  facts.abc = await generateDumpFile(dumps.abc, { instance: 'abc', scale: 'small' });
  first = { yay: await run('yay', dumps.yay), abc: await run('abc', dumps.abc) };
}, 240_000);
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePools();
});

describe('runs and V6–V10', () => {
  it('both instances pass every check, with V6–V10 in the report and V8 pending', () => {
    for (const r of [first.yay, first.abc]) {
      expect(r.summary).toContain('PASS');
      for (const id of ['V6', 'V7', 'V8', 'V9', 'V10']) expect(check(r, id)?.pass, `${id}`).toBe(true);
      expect(check(r, 'V8')?.details).toMatchObject({ pending: true });
      const v6 = check(r, 'V6')?.details as {
        legacyQr: { vectors: number; resolved: number };
        accessTokens: { live: number };
      };
      expect(v6.legacyQr.vectors).toBeGreaterThan(20);
      expect(v6.legacyQr.resolved).toBe(v6.legacyQr.vectors);
      expect(v6.accessTokens.live).toBeGreaterThan(0);
      const v7 = check(r, 'V7')?.details as { queries: { diffCount: number; keys: number }[] };
      expect(v7.queries.length).toBeGreaterThanOrEqual(14);
      expect(v7.queries.every((q) => q.diffCount === 0)).toBe(true);
    }
  });
});

describe('T3 remainder', () => {
  it('migrates the venues directory: org venues, slug clash suffix, invalid coordinates dropped, events linked', async () => {
    const r = await one(
      sql()<{ yay: string; abc: string; n: number; linked: number; bad_geo: number }[]>`
        select (select v.slug from venues.venues v join legacy.ref r on r.new_id = v.id where r.instance = 'yay' and r.entity = 'venues' and v.name = 'Union Depot') as yay,
               (select v.slug from venues.venues v join legacy.ref r on r.new_id = v.id where r.instance = 'abc' and r.entity = 'venues' and v.name = 'Union Depot') as abc,
               (select count(*)::int from legacy.ref where entity = 'venues') as n,
               (select count(*)::int from events.events e join legacy.ref r on r.new_id = e.id and r.entity = 'events' where e.venue_id is not null) as linked,
               (select count(*)::int from venues.venues v join legacy.ref r on r.new_id = v.id and r.entity = 'venues' where v.latitude is null) as bad_geo`,
    );
    // The first venue has the same slug on both instances: the second run's copy is suffixed.
    expect([r.yay, r.abc].sort()).toEqual(['union-depot', 'union-depot-abc-1']);
    expect(r.linked).toBeGreaterThan(0);
    expect(r.bad_geo).toBeGreaterThanOrEqual(1);
    expect(first.yay.report.exceptions.venue_coordinates_invalid).toBe(1);
    // Every linked venue belongs to the event's org.
    const [cross] =
      await sql()`select count(*)::int as n from events.events e join venues.venues v on v.id = e.venue_id where v.org_id <> e.org_id`;
    expect(cross?.n).toBe(0);
  });

  it('maps categories to the taxonomy (unmapped → other, listed) and gives abc events an org tag', async () => {
    const r = await one(
      sql()<{ other: number; music: number; abc_tags: number }[]>`
        select (select count(*)::int from events.events e join legacy.ref r on r.new_id = e.id and r.entity = 'events'
                join legacy_yay.events le on le.id::text = r.legacy_id and r.instance = 'yay' where le.category_id = 6 and e.category = 'other') as other,
               (select count(*)::int from events.events e join legacy.ref r on r.new_id = e.id and r.entity = 'events' and r.instance = 'yay'
                join legacy_yay.events le on le.id::text = r.legacy_id where le.category_id = 1 and e.category = 'music') as music,
               (select count(*)::int from events.event_tags t join legacy.ref r on r.new_id = t.event_id and r.instance = 'abc' and r.entity = 'events') as abc_tags`,
    );
    expect(r.music).toBeGreaterThan(0);
    expect(r.abc_tags).toBeGreaterThan(0);
    expect(first.yay.report.exceptions.category_unmapped).toBe(1);
  });

  it('infers a series from one org’s yearly events, never across orgs', async () => {
    const group = facts.yay?.facts.seriesGroups[0] ?? [];
    const rows = await sql()<{ series_id: string; org_id: string; legacy: string }[]>`
      select se.series_id, se.org_id, r.legacy_id as legacy from events.series_events se
      join legacy.ref r on r.new_id = se.event_id and r.instance = 'yay' and r.entity = 'events'
      where r.legacy_id = any(${group.map(String)})`;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((x) => x.series_id)).size).toBe(1);
    const s = await one(sql()<{ name: string; members: number }[]>`
      select s.name, (select count(*)::int from events.series_events x where x.series_id = s.id) as members
      from events.series s where s.id = ${rows[0]?.series_id ?? ''}`);
    expect(s.name).toMatch(/Winter Gala$/);
    expect(s.members).toBe(2);
    expect(first.yay.report.exceptions.series_inferred).toBeGreaterThanOrEqual(1);
  });

  it('turns each legacy chart into a floor plan with the chart as underlay and every seat, sold to its ticket', async () => {
    const gala = await one(
      sql()<
        {
          id: string;
          org_id: string;
          total: number;
          sold: number;
          blocked: number;
          status: string;
          doc: { underlay: { url: string } | null };
        }[]
      >`
        select e.id, e.org_id,
               (select count(*)::int from seating.event_seats s where s.event_id = e.id) as total,
               (select count(*)::int from seating.event_seats s where s.event_id = e.id and s.status = 'sold') as sold,
               (select count(*)::int from seating.event_seats s where s.event_id = e.id and s.block_reason = 'kill') as blocked,
               l.status, l.doc
        from events.events e join seating.event_layouts l on l.event_id = e.id where e.name = ${DEMO.pastEventTitle}`,
    );
    expect(gala.total).toBe(56); // 4 rows × 10 chairs + 2 tables of 8
    expect(gala.blocked).toBe(1); // the switched-off seat
    expect(gala.sold).toBe(7); // the gala's seated demo bookings
    expect(gala.status).toBe('locked');
    expect(gala.doc.underlay?.url).toMatch(/^legacy\/yay\/storage\/seatcharts\/yay-\d+\.png$/);
    // Every sold seat is the seat the legacy attendee booked, and the ticket prints it.
    const sold = await sql()<
      {
        seat_uuid: string;
        legacy_seat: string;
        attendee: string;
        holder: string;
        seat_label: string;
        label: string;
      }[]
    >`
      select s.seat_uuid, a.seat_id::text as legacy_seat, a.name as attendee, t.holder_name as holder, t.seat_label, s.label
      from seating.event_seats s join ticketing.tickets t on t.id = s.ticket_id
      join legacy.ref r on r.new_id = t.id and r.instance = 'yay' and r.entity = 'booking_units'
      join legacy_yay.attendees a on a.booking_id::text = split_part(r.legacy_id, ':', 1) and a.seat_id is not null
      where s.event_id = ${gala.id} and s.status = 'sold'`;
    expect(sold).toHaveLength(7);
    for (const x of sold) {
      if (x.legacy_seat && x.seat_uuid === legacySeatUuid('yay', x.legacy_seat))
        expect(x.holder).toBe(x.attendee);
      expect(x.seat_label).toBe(x.label);
    }
    expect(
      sold.filter((x) => x.seat_uuid === legacySeatUuid('yay', x.legacy_seat)).length,
    ).toBeGreaterThanOrEqual(6);
    // A reusable org plan per chart.
    const [layouts] =
      await sql()`select count(*)::int as n from seating.layouts l join legacy.ref r on r.new_id = l.id and r.entity = 'seatcharts' and r.instance = 'yay'`;
    expect(layouts?.n).toBe(facts.yay?.facts.seatCharts.length);
  });

  it('keeps per-date seats of a repetitive event on the tickets only (listed)', async () => {
    const rep = facts.yay?.facts.seatCharts.find((c) => c.repetitive);
    if (!rep) throw new Error('no repetitive chart');
    const [r] = await sql()`
      select count(*) filter (where s.status = 'sold')::int as sold, count(*)::int as total
      from seating.event_seats s join legacy.ref e on e.new_id = s.event_id and e.instance = 'yay' and e.entity = 'events'
      where e.legacy_id = ${String(rep.eventId)}`;
    expect(r?.total).toBe(56);
    expect(r?.sold).toBe(0);
    expect(first.yay.report.exceptions.seat_per_date_not_migrated).toBeGreaterThan(0);
  });

  it('scales a chart to its image’s natural size once the media manifest is loaded', async () => {
    const chart = facts.yay?.facts.seatCharts[0];
    await sql()`insert into legacy.media_images (instance, path, width_px, height_px)
                values ('yay', ${`seatcharts/yay-${chart?.chartId}.png`}, 1600, 900) on conflict do nothing`;
    const r = await run('yay');
    expectPass(r);
    const [l] = await sql()`select (doc -> 'underlay' ->> 'width')::int as w from seating.layouts l
                            join legacy.ref r on r.new_id = l.id and r.instance = 'yay' and r.entity = 'seatcharts'
                            where r.legacy_id = ${String(chart?.chartId)}`;
    expect(l?.w).toBe(1600 * CM_PER_PX);
    await sql()`delete from legacy.media_images where instance = 'yay'`;
  });
});

describe('T6 communications', () => {
  it('never opts anyone in: newsletter consent granted (then withdrawn), everyone else unknown_legacy', async () => {
    const r = await one(
      sql()<
        {
          platform_kind: string;
          granted: number;
          withdrawn: number;
          unknown: number;
          granted_other: number;
          without: number;
        }[]
      >`
        select (select kind from tenancy.organizations o join legacy.ref r on r.new_id = o.id where r.entity = 'platform_org') as platform_kind,
               (select count(*)::int from crm.consents where evidence = 'legacy_newsletter' and status = 'granted') as granted,
               (select count(*)::int from crm.consents where evidence = 'legacy_newsletter_unsubscribe' and status = 'withdrawn') as withdrawn,
               (select count(*)::int from crm.consents where status = 'unknown_legacy') as unknown,
               (select count(*)::int from crm.consents where status = 'granted' and evidence <> 'legacy_newsletter'
                  -- migrated orgs only: other suites' fixture orgs (checkout opt-ins) share this database
                  and org_id in (select new_id from legacy.ref where entity in ('organizers', 'platform_org'))) as granted_other,
               (select count(*)::int from crm.contacts c where c.source = 'legacy'
                  and c.org_id in (select new_id from legacy.ref where entity in ('organizers', 'platform_org'))
                  and not exists (select 1 from crm.consents x where x.contact_id = c.id)) as without`,
    );
    expect(r.platform_kind).toBe('platform');
    const subs = [...(facts.yay?.facts.newsletter ?? []), ...(facts.abc?.facts.newsletter ?? [])];
    expect(r.granted).toBe(subs.filter((s) => s.email.includes('@')).length);
    expect(r.withdrawn).toBe(subs.filter((s) => s.unsubscribed && s.email.includes('@')).length);
    expect(r.unknown).toBeGreaterThan(50);
    expect(r.granted_other).toBe(0);
    expect(r.without).toBe(0);
    expect(first.yay.report.exceptions.newsletter_invalid_email).toBe(1);
  });

  it('registers legacy push tokens on their real platform, and never copies notification data', async () => {
    const r = await one(
      sql()<{ fcm: number; apns: number; leaked: number }[]>`
        select count(*) filter (where platform = 'fcm')::int as fcm, count(*) filter (where platform = 'apns')::int as apns,
               (select count(*)::int from notifications.inbox_items where params::text like '%invented-guest-password%')
             + (select count(*)::int from platform.domain_events where payload::text like '%invented-guest-password%')
             + (select count(*)::int from notifications.messages where subject like '%invented-guest-password%') as leaked
        from notifications.push_tokens where source = 'legacy'`,
    );
    expect(r.fcm).toBeGreaterThan(0);
    expect(r.apns).toBeGreaterThan(0);
    expect(r.leaked).toBe(0);
  });

  it('plans the buyers’ order-link messages without sending one (dry run)', async () => {
    const report = await orderLinkReport('yay');
    expect(report.dryRun).toBe(true);
    expect(report.planned).toBeGreaterThan(0);
    const [ended] = await sql()`
      select count(*)::int as n from legacy.order_link_plan p join events.events e on e.id = p.event_id
      where p.instance = 'yay' and e.ends_at <= ${FREEZE.toISOString()}`;
    expect(ended?.n).toBe(0);
    const [sent] = await sql()`
      select count(*)::int as n from notifications.messages m join legacy.order_link_plan p on p.order_id = m.order_id`;
    expect(sent?.n).toBe(0);
    expect(Object.keys(report.skipped).every((k) => /^(order_|invalid_email|no_)/.test(k))).toBe(true);
    for (const s of report.sample) expect(s.email).toMatch(/^.•••@/);
  });
});

describe('T8 auth artifacts', () => {
  it('carries live personal access tokens (hashed): the legacy bearer still works, expired and orphan ones do not', async () => {
    const tokens = facts.yay?.facts.accessTokens ?? [];
    const live = tokens.find((t) => !t.expired && !t.orphan);
    const expired = tokens.find((t) => t.expired && !t.orphan);
    const orphan = tokens.find((t) => t.orphan);
    if (!live || !expired || !orphan) throw new Error('missing token facts');
    const who = await verifyLegacyAccessToken(`${live.id}|${live.plain}`);
    const user = await one(
      sql()<
        { new_id: string }[]
      >`select new_id from legacy.ref where instance = 'yay' and entity = 'users' and legacy_id = ${String(live.userId)}`,
    );
    expect(who).toMatchObject({ userId: user.new_id, instance: 'yay', abilities: ['*'] });
    expect(await verifyLegacyAccessToken(`${live.id}|${live.plain}x`)).toBeNull();
    expect(await verifyLegacyAccessToken(`${live.id + 1}|${live.plain}`)).toBeNull();
    expect(await verifyLegacyAccessToken(`${expired.id}|${expired.plain}`)).toBeNull();
    expect(await verifyLegacyAccessToken(`${orphan.id}|${orphan.plain}`)).toBeNull();
    expect(first.yay.report.exceptions.access_token_revoked_no_user).toBe(1);
    // Only hashes are stored.
    const [plain] =
      await sql()`select count(*)::int as n from auth.legacy_tokens where token_hash = ${live.plain}`;
    expect(plain?.n).toBe(0);
  });

  it('keeps magic login links until they expire, single use', async () => {
    const magic = facts.yay?.facts.magicTokens ?? [];
    const live = magic.find((m) => Date.parse(m.expiresAt) > FREEZE.getTime());
    const dead = magic.find((m) => Date.parse(m.expiresAt) <= FREEZE.getTime());
    if (!live || !dead) throw new Error('missing magic facts');
    const at = new Date(FREEZE.getTime() + 3_600_000);
    expect(await consumeLegacyMagicLink(live.token, at)).toMatchObject({ instance: 'yay' });
    expect(await consumeLegacyMagicLink(live.token, at)).toBeNull();
    expect(await consumeLegacyMagicLink(dead.token, at)).toBeNull();
    const [n] =
      await sql()`select count(*)::int as n from auth.legacy_tokens where token_hash = ${dead.token} or token_hash = ${live.token}`;
    expect(n?.n).toBe(0);
  });

  it('keeps a password reset under 60 minutes old at the freeze, drops older ones', async () => {
    const rows = await sql()<{ created_at: string; expires_at: string }[]>`
      select created_at::text, expires_at::text from auth.legacy_tokens where kind = 'password_reset' and instance = 'yay'`;
    expect(rows).toHaveLength(1);
  });

  it('dual-hash grace: a merged identity signs in with either instance’s password', async () => {
    const email = 'member.3@example.com';
    await sql()`update legacy_abc.users set password = ${ABC_PASSWORD_HASH} where lower(btrim(email)) = ${email}`;
    const r = await run('abc');
    expectPass(r);
    const acct = await one(sql()<{ password: string }[]>`
      select a.password from auth.accounts a join auth.users u on u.id = a.user_id where u.email = ${email}`);
    expect(acct.password.startsWith('$yydual$')).toBe(true);
    expect(await verifyPassword({ hash: acct.password, password: 'synthetic-password' })).toBe(true);
    expect(await verifyPassword({ hash: acct.password, password: 'synthetic-password-abc' })).toBe(true);
    expect(await verifyPassword({ hash: acct.password, password: 'other' })).toBe(false);
    // A rerun keeps it (T1 never overwrites it; T8 recomputes the same value).
    await run('abc');
    const again = await one(sql()<{ password: string }[]>`
      select a.password from auth.accounts a join auth.users u on u.id = a.user_id where u.email = ${email}`);
    expect(again.password).toBe(acct.password);
    expect(check(r, 'V6')?.pass).toBe(true);
    // The abc dump again (one password): the grace ends, the primary bcrypt comes back.
    await sql()`update legacy_abc.users set password = ${SYNTH_PASSWORD_HASH} where lower(btrim(email)) = ${email}`;
    expectPass(await run('abc'));
    const back = await one(sql()<{ password: string }[]>`
      select a.password from auth.accounts a join auth.users u on u.id = a.user_id where u.email = ${email}`);
    expect(back.password).toBe(SYNTH_PASSWORD_HASH);
  });
});

describe('T9 derived data', () => {
  it('builds participation, contact totals and monthly metrics that add up to the orders', async () => {
    const buyer = await one(
      sql()<{ tickets: number; spend: number; orders: number; stats_spend: number }[]>`
        select p.tickets, p.spend_minor::int as spend,
               (select count(*)::int from orders.orders o where o.buyer_contact_id = c.id and o.event_id = p.event_id) as orders,
               (select sum(spend_minor)::int from crm.contact_stats s where s.contact_id = c.id) as stats_spend
        from crm.contacts c join crm.event_participation p on p.contact_id = c.id
        join events.events e on e.id = p.event_id
        where c.email_norm = ${DEMO.buyerEmail} and e.name = ${DEMO.eventTitle}`,
    );
    expect(buyer.tickets).toBe(2);
    expect(buyer.spend).toBe(9000);
    expect(buyer.stats_spend).toBeGreaterThanOrEqual(9000);
    const m = await one(
      sql()<{ metric: number; orders: number }[]>`
        select (select coalesce(sum(value), 0)::bigint from platform.metric_timeseries t
                where t.metric = 'sales.gross' and t.source = 'legacy' and t.org_id in (select org_id from legacy.ref where instance = 'yay' and entity = 'organizers')) as metric,
               (select coalesce(sum(o.total_minor), 0)::bigint from orders.orders o join legacy.ref r on r.new_id = o.id and r.instance = 'yay' and r.entity = 'orders'
                where o.paid_at is not null and o.status in ('paid', 'partially_refunded', 'refunded')) as orders`,
    );
    expect(Number(m.metric)).toBe(Number(m.orders));
  });

  it('backfills history as replayed events: logged, stamped, published, and ignored by every mailer', async () => {
    const r = await one(
      sql()<{ n: number; unstamped: number; paid: number; admitted: number }[]>`
        select count(*)::int as n, count(*) filter (where log_seq is null or published_at is null)::int as unstamped,
               count(*) filter (where type = 'order.paid')::int as paid, count(*) filter (where type = 'ticket.admitted')::int as admitted
        from platform.domain_events where replayed`,
    );
    expect(r.n).toBeGreaterThan(100);
    expect(r.unstamped).toBe(0);
    expect(r.paid).toBeGreaterThan(0);
    expect(r.admitted).toBeGreaterThan(0);
    // The log stays gap-free.
    const [g] =
      await sql()`select count(*)::int as n, max(log_seq) - min(log_seq) + 1 as span from platform.domain_events where log_seq is not null`;
    expect(Number(g?.span)).toBe(g?.n);

    const notifier = createNotifier();
    const handled: string[] = [];
    const spy = (s: Subscriber): Subscriber => ({
      ...s,
      handle: async (tx, e) => {
        handled.push(e.id);
        await s.handle(tx, e);
      },
    });
    const mailers = [
      spy(ticketMailer({ notifier, appOrigin: 'http://localhost:3100' })),
      spy(refundMailer({ notifier, appOrigin: 'http://localhost:3100' })),
    ];
    const events = await sql()<
      {
        id: string;
        org_id: string;
        type: string;
        version: number;
        aggregate_type: string;
        aggregate_id: string;
        payload: unknown;
        log_seq: string;
      }[]
    >`
      select id, org_id, type, version, aggregate_type, aggregate_id, payload, log_seq from platform.domain_events
      where replayed and type in ('order.paid', 'order.refunded') order by log_seq limit 40`;
    const [before] = await sql()`select count(*)::int as n from notifications.messages`;
    for (const e of events) {
      const published: PublishedEvent = {
        id: e.id,
        orgId: e.org_id,
        type: e.type,
        version: e.version,
        aggregateType: e.aggregate_type,
        aggregateId: e.aggregate_id,
        payload: e.payload,
        logSeq: Number(e.log_seq),
        replayed: true,
      };
      for (const m of mailers) {
        expect(subscribes(m, published)).toBe(false); // the relay never enqueues it
        if (m.events.includes(`${e.type}@1`)) expect(await consumeEvent(m, published)).toBe(false); // nor would a handler run
      }
    }
    expect(handled).toEqual([]);
    const [after] = await sql()`select count(*)::int as n from notifications.messages`;
    expect(after?.n).toBe(before?.n);
    // A projector that opts in does see history.
    const seen: string[] = [];
    const projector = defineSubscriber({
      name: 'test.history-projector',
      events: ['order.paid@1'],
      acceptsReplayed: true,
      handle: async (_tx, e) => void seen.push(e.id),
    });
    const paid = events.find((e) => e.type === 'order.paid');
    if (!paid) throw new Error('no replayed order.paid');
    expect(
      await consumeEvent(projector, {
        id: paid.id,
        orgId: paid.org_id,
        type: paid.type,
        version: 1,
        aggregateType: 'order',
        aggregateId: paid.aggregate_id,
        payload: paid.payload,
        logSeq: 0,
        replayed: true,
      }),
    ).toBe(true);
    expect(seen).toEqual([paid.id]);
  });
});

describe('URL inventory and redirects', () => {
  it('redirects every changed legacy URL through the web proxy’s lookup', async () => {
    const urls = await sql()<{ host: string; path: string; target: string }[]>`
      select host, path, target from legacy.url_inventory where instance = 'yay' and planned_status = 308 order by path`;
    expect(urls.some((u) => u.path === '/events/lakeshore_spring_gala')).toBe(true);
    expect(urls.some((u) => u.path.startsWith('/') && u.target.startsWith('/o/'))).toBe(true);
    for (const u of urls.slice(0, 20)) {
      const hit = await matchLegacyRedirect(u.host, u.path);
      expect(hit, u.path).toMatchObject({ location: u.target, status: 308 });
    }
    // Unchanged paths are not redirected.
    const same = await one(sql()<{ host: string; path: string }[]>`
      select host, path from legacy.url_inventory where instance = 'yay' and planned_status = 200 limit 1`);
    expect(await matchLegacyRedirect(same.host, same.path)).toBeNull();
  });
});

describe('isolation of migrated orgs (app_user, RLS)', () => {
  it('an org sees none of another migrated org’s new rows', async () => {
    const [a, b] = (
      await sql()<{ org_id: string }[]>`
      select p.org_id from crm.event_participation p join legacy.ref r on r.org_id = p.org_id and r.instance = 'yay' and r.entity = 'organizers'
      group by p.org_id order by count(*) desc limit 2`
    ).map((r) => r.org_id);
    if (!a || !b) throw new Error('need two migrated orgs');
    const tables = [
      'crm.event_participation',
      'crm.contact_stats',
      'crm.consents',
      'platform.metric_timeseries',
      'venues.venues',
      'seating.layouts',
      'seating.event_seats',
      'notifications.push_tokens',
      'marketplace.legacy_redirects',
      'events.series',
      'platform.domain_events',
    ];
    await withTenant(
      createCtx({ orgId: a, actor: { type: 'system', name: 'm22c-isolation' } }),
      async (tx) => {
        for (const t of tables) {
          const [other] = await tx.execute<{ n: number }>(
            dsql.raw(`select count(*)::int as n from ${t} where org_id = '${b}'`),
          );
          expect(other?.n, t).toBe(0);
        }
        const [own] = await tx.execute<{ n: number }>(
          dsql`select count(*)::int as n from crm.event_participation`,
        );
        expect(own?.n).toBeGreaterThan(0);
      },
    );
    // Control data is not tenant data: app_user cannot read the legacy control schema.
    await expect(
      withTenant(createCtx({ orgId: a, actor: { type: 'system', name: 'm22c-isolation' } }), (tx) =>
        tx.execute(dsql`select 1 from legacy.url_inventory limit 1`),
      ),
    ).rejects.toThrow();
  });
});

describe('idempotence and V10', () => {
  it('a rerun on the same dump changes nothing and reproduces every checksum', async () => {
    const tables = [
      'venues.venues',
      'events.series',
      'events.series_events',
      'events.event_tags',
      'seating.layouts',
      'seating.event_layouts',
      'seating.event_seats',
      'crm.consents',
      'notifications.push_tokens',
      'auth.legacy_tokens',
      'crm.event_participation',
      'crm.contact_stats',
      'platform.metric_timeseries',
      'platform.domain_events',
      'marketplace.legacy_redirects',
    ];
    const print = async () => {
      const out: Record<string, string> = {};
      for (const t of tables) {
        const [r] = await sql().unsafe(
          `select count(*)::text || ':' || coalesce(md5(string_agg(id::text, ',' order by id)), '') as f from ${t}`,
        );
        out[t] = String((r as unknown as { f: string }).f);
      }
      return out;
    };
    const before = await print();
    const r = await run('yay', dumps.yay);
    expectPass(r);
    expect(await print()).toEqual(before);
    const v10 = check(r, 'V10')?.details as { baselineRun: number | null; changed: string[] };
    expect(v10.baselineRun).not.toBeNull();
    expect(v10.changed).toEqual([]);
  });
});

describe('planted defects', () => {
  it('V6 catches a legacy QR that no longer resolves; V7 a golden total; V9 a missing redirect', async () => {
    const [bc] = await sql()`
      select b.id, b.payload from ticketing.ticket_barcodes b join ticketing.tickets t on t.id = b.ticket_id
      where b.format = 'legacy_eventmie' and b.instance = 'yay' and t.status = 'active' limit 1`;
    await sql()`update ticketing.ticket_barcodes set active = false where id = ${bc?.id}`;
    const [o] =
      await sql()`select o.id, o.total_minor from orders.orders o join legacy.ref r on r.new_id = o.id and r.instance = 'yay' and r.entity = 'orders' limit 1`;
    await sql()`update orders.orders set total_minor = total_minor + 1, subtotal_minor = subtotal_minor + 1 where id = ${o?.id}`;
    const [rd] =
      await sql()`select id, source, host, target, org_id from marketplace.legacy_redirects where source = '/events/lakeshore_spring_gala' and host = 'yayatoh.com'`;
    await sql()`delete from marketplace.legacy_redirects where id = ${rd?.id}`;
    try {
      const bad = await revalidate('yay');
      expect(bad.pass).toBe(false);
      expect(check(bad, 'V6')?.pass).toBe(false);
      expect(check(bad, 'V7')?.pass).toBe(false);
      expect(check(bad, 'V9')?.pass).toBe(false);
    } finally {
      await sql()`update ticketing.ticket_barcodes set active = true where id = ${bc?.id}`;
      await sql()`update orders.orders set total_minor = total_minor - 1, subtotal_minor = subtotal_minor - 1 where id = ${o?.id}`;
      await sql()`insert into marketplace.legacy_redirects (id, org_id, host, source, match, target, status)
                  values (${rd?.id}, ${rd?.org_id}, ${rd?.host}, ${rd?.source}, 'exact', ${rd?.target}, 308)`;
    }
    const good = await revalidate('yay');
    expect(good.pass).toBe(true);
  });
});
