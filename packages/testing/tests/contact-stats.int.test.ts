import {
  audienceExportBulk,
  CONTACT_SIGNAL_EVENTS,
  catchUpContactSignals,
  contactSignalsSubscriber,
  participationProjector,
  previewAudienceQuery,
  refreshContactStatsTx,
  rescoreOrgContacts,
  saveSegmentCommand,
} from '@yayatoh/audiences';
import {
  contactDsarTx,
  contactStatsQuery,
  contactValueQuery,
  orgContactStatsQuery,
  orgValueQuery,
  quintiles,
  type SegmentDefinition,
} from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { consumeEvent, emitEvents } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ContactStatsScenario,
  contactStatsScenario,
  JOHN_DOE_EXPECTED,
  ports,
  runBulk,
  userCtx,
} from '../src/index.ts';
import { bareOrg } from '../src/marketing.ts';

type Org = Awaited<ReturnType<typeof bareOrg>>;
let a: Org;
let b: Org;
let sa: ContactStatsScenario;
let sb: ContactStatsScenario;
const tag = uuidv7().slice(-8);
const sys = (orgId: string): Ctx => createCtx({ orgId, actor: { type: 'system', name: 'test' } });

const and = (...conditions: unknown[]) =>
  ({ version: 1, root: { type: 'group', op: 'and', conditions } }) as SegmentDefinition;
const LTV_OVER_1000 = { type: 'ltv', currency: 'USD', op: 'gt', amountMinor: 100_000 };
const NO_SHOW_UNDER_20 = { type: 'stats', metric: 'noShowPct', op: 'lt', value: 20 };

const preview = (definition: SegmentDefinition, ctx: Ctx = a.ctx()) =>
  executeQuery(previewAudienceQuery, { definition, eventId: null, limit: 100 }, ctx, ports);
const names = async (definition: SegmentDefinition, ctx: Ctx = a.ctx()) =>
  (await preview(definition, ctx)).rows.map((r) => r.name).sort();

async function snapshot(orgId: string) {
  return withTenant(sys(orgId), async (tx) => ({
    scores:
      await tx.execute(sql`select contact_id, events, events_registered, events_attended, past_registered,
      no_shows, sessions_attended, campaigns_opened, orders, monetary_minor, monetary_currency, first_seen_at,
      last_seen_at, engagement_score, no_show_bps from crm.contact_scores order by contact_id`),
    stats:
      await tx.execute(sql`select contact_id, currency, orders, tickets, events, events_attended, spend_minor,
      first_seen_at, last_seen_at from crm.contact_stats order by contact_id, currency`),
    signals: await tx.execute(
      sql`select contact_id, kind, ref_id from crm.contact_signals order by contact_id, kind, ref_id`,
    ),
  }));
}

beforeAll(async () => {
  a = await bareOrg(`stats-a-${tag}`, 'Stats A');
  b = await bareOrg(`stats-b-${tag}`, 'Stats B');
  sa = await contactStatsScenario(a.orgId);
  sb = await contactStatsScenario(b.orgId);
}, 180_000);
afterAll(closePools);

describe('contact stats (M6.1b)', () => {
  it('the vision’s John Doe reproduces exactly', async () => {
    const s = await executeQuery(contactStatsQuery, { contactId: sa.people.john.id }, a.ctx(), ports);
    expect(s).toMatchObject({
      name: 'John Doe',
      live: true,
      events: JOHN_DOE_EXPECTED.events,
      eventsRegistered: JOHN_DOE_EXPECTED.eventsRegistered,
      eventsAttended: JOHN_DOE_EXPECTED.eventsAttended,
      pastRegistered: JOHN_DOE_EXPECTED.pastRegistered,
      noShows: JOHN_DOE_EXPECTED.noShows,
      sessionsAttended: JOHN_DOE_EXPECTED.sessionsAttended,
      campaignsOpened: JOHN_DOE_EXPECTED.campaignsOpened,
      engagementScore: JOHN_DOE_EXPECTED.engagementScore,
      noShowBps: JOHN_DOE_EXPECTED.noShowBps,
    });
    expect(s.rfm?.frequency).toBe(JOHN_DOE_EXPECTED.rfmFrequency);
    // No money in the stats DTO, whoever asks.
    expect(JSON.stringify(s)).not.toMatch(/180000|spend|amount|monetary/i);
    const v = await executeQuery(contactValueQuery, { contactId: sa.people.john.id }, a.ctx(), ports);
    expect(v.lifetime).toEqual([
      { currency: 'USD', amountMinor: JOHN_DOE_EXPECTED.lifetimeMinor, orders: JOHN_DOE_EXPECTED.orders },
    ]);
    expect(v.monetaryQuintile).toBe(JOHN_DOE_EXPECTED.rfmMonetary);
    expect(v.monetaryCurrency).toBe('USD');
    // Attended A, VIP at B (and went), registered for C: the participation behind the numbers.
    const rows = await withTenant(sys(a.orgId), (tx) =>
      tx.execute<{ event_id: string; registered: boolean; checked_in: boolean; spend_minor: string }>(
        sql`select event_id, registered, checked_in, spend_minor::text from crm.event_participation where contact_id = ${sa.people.john.id}`,
      ),
    );
    const byEvent = new Map(rows.map((r) => [r.event_id, r]));
    expect(byEvent.get(sa.events.a)).toMatchObject({
      registered: true,
      checked_in: true,
      spend_minor: '30000',
    });
    expect(byEvent.get(sa.events.b)).toMatchObject({
      registered: true,
      checked_in: true,
      spend_minor: '120000',
    });
    expect(byEvent.get(sa.events.c)).toMatchObject({
      registered: true,
      checked_in: false,
      spend_minor: '30000',
    });
  });

  it('the neighbours: no-shows, the prior, and the RFM quintiles match the documented formula', async () => {
    const stats = async (id: string) => executeQuery(contactStatsQuery, { contactId: id }, a.ctx(), ports);
    const mia = await stats(sa.people.mia.id);
    expect(mia).toMatchObject({ pastRegistered: 2, noShows: 2, noShowBps: 4_286, eventsAttended: 0 });
    const ray = await stats(sa.people.ray.id);
    expect(ray).toMatchObject({ pastRegistered: 1, noShows: 0, noShowBps: 1_667, engagementScore: 29 });
    const zoe = await stats(sa.people.zoe.id);
    expect(zoe).toMatchObject({ pastRegistered: 0, noShows: 0, noShowBps: 2_000, engagementScore: 0 });
    // Recency: the same quintile function over the stored last-seen times.
    const seen = await withTenant(sys(a.orgId), (tx) =>
      tx.execute<{ contact_id: string; t: string }>(
        sql`select contact_id, extract(epoch from last_seen_at)::text as t from crm.contact_scores where events > 0`,
      ),
    );
    const q = quintiles(seen.map((r) => Number(r.t)));
    for (const [i, r] of seen.entries()) {
      const s = await stats(r.contact_id);
      expect(s.rfm?.recency).toBe(q[i]);
    }
    expect((await stats(sa.people.ray.id)).rfm?.frequency).toBe(1);
    expect((await stats(sa.people.mia.id)).rfm?.frequency).toBe(3);
  });

  it('replaying every event never double-counts, and the rescore is idempotent', async () => {
    const before = await snapshot(a.orgId);
    // Every participation and signal event again, through the subscribers' handlers directly
    // (bypassing exactly-once), then the full rescore twice.
    const events = await withTenant(sys(a.orgId), (tx) =>
      tx.execute<{ id: string; type: string; version: number; payload: unknown; aggregate_id: string }>(
        sql`select id, type, version, payload, aggregate_id from platform.domain_events
            where type in ('order.paid', 'ticket.admitted', 'session.attended', 'campaign.opened') order by id`,
      ),
    );
    expect(events.length).toBeGreaterThanOrEqual(7 + 3 + 4 + 2);
    for (const e of events) {
      const full = {
        id: e.id,
        orgId: a.orgId,
        type: e.type,
        version: e.version,
        aggregateType: 'x',
        aggregateId: e.aggregate_id,
        payload: e.payload,
        occurredAt: new Date().toISOString(),
        logSeq: 0,
      };
      for (const sub of [participationProjector(), contactSignalsSubscriber()])
        if (sub.events.includes(`${e.type}@${e.version}` as never))
          await withTenant(sys(a.orgId), (tx) => sub.handle(tx, full));
    }
    // Exactly-once also holds through the normal path.
    const again = await consumeEvent(contactSignalsSubscriber(), {
      id: events.find((e) => e.type === 'session.attended')?.id ?? '',
      orgId: a.orgId,
      type: 'session.attended',
      version: 1,
      aggregateType: 'session',
      aggregateId: sa.sessionIds[0] ?? '',
      payload: {},
      logSeq: 0,
    });
    expect(again).toBe(false);
    expect(await catchUpContactSignals(a.orgId)).toBe(0);
    expect(await rescoreOrgContacts(a.orgId)).toBe(4);
    expect(await rescoreOrgContacts(a.orgId, { pageSize: 1 })).toBe(4);
    const after = await snapshot(a.orgId);
    expect(after).toEqual(before);
    const s = await executeQuery(contactStatsQuery, { contactId: sa.people.john.id }, a.ctx(), ports);
    expect(s.sessionsAttended).toBe(4);
    expect(s.campaignsOpened).toBe(2);
  });

  it('a session attended again (same session) counts once; a new one counts', async () => {
    const extra = uuidv7();
    const emit = (sessionId: string) =>
      withTenant(sys(a.orgId), (tx) =>
        emitEvents(tx, sys(a.orgId), [
          {
            type: CONTACT_SIGNAL_EVENTS[0].split('@')[0] as string,
            version: 1,
            aggregateType: 'session',
            aggregateId: sessionId,
            payload: { eventId: sa.events.b, sessionId, contactId: sa.people.ray.id },
          },
        ]),
      );
    await emit(sa.sessionIds[0] as string);
    await emit(sa.sessionIds[0] as string);
    expect(await catchUpContactSignals(a.orgId)).toBe(2);
    const once = await executeQuery(contactStatsQuery, { contactId: sa.people.ray.id }, a.ctx(), ports);
    expect(once.sessionsAttended).toBe(1);
    await emit(extra);
    await catchUpContactSignals(a.orgId);
    const twice = await executeQuery(contactStatsQuery, { contactId: sa.people.ray.id }, a.ctx(), ports);
    expect(twice.sessionsAttended).toBe(2);
    // 10 × 1 + 5 × 2 = 20 points → round(100 × 20 / 45) = 44.
    expect(twice.engagementScore).toBe(44);
    // A signal for a contact of another org is dropped (RLS hides it).
    await withTenant(sys(a.orgId), (tx) =>
      emitEvents(tx, sys(a.orgId), [
        {
          type: 'campaign.opened',
          version: 1,
          aggregateType: 'campaign',
          aggregateId: extra,
          payload: { campaignId: extra, contactId: sb.people.john.id },
        },
      ]),
    );
    await catchUpContactSignals(a.orgId);
    const bJohn = await executeQuery(contactStatsQuery, { contactId: sb.people.john.id }, b.ctx(), ports);
    expect(bJohn.campaignsOpened).toBe(2);
  });

  it('a registration whose event ends becomes a no-show at the next rescore', async () => {
    const zoe = sa.people.zoe.id;
    // C ends in 2030: rescore as if it were 2031.
    await withTenant({ ...sys(a.orgId), now: new Date('2031-01-01T00:00:00Z') }, (tx) =>
      refreshContactStatsTx(tx, { ...sys(a.orgId), now: new Date('2031-01-01T00:00:00Z') }, [zoe]),
    );
    const later = await executeQuery(contactStatsQuery, { contactId: zoe }, a.ctx(), ports);
    // (1 + 1) / (1 + 5) = 33.33 %.
    expect(later).toMatchObject({ pastRegistered: 1, noShows: 1, noShowBps: 3_333 });
    await rescoreOrgContacts(a.orgId);
    const now = await executeQuery(contactStatsQuery, { contactId: zoe }, a.ctx(), ports);
    expect(now).toMatchObject({ pastRegistered: 0, noShows: 0, noShowBps: 2_000 });
  });

  it('segments on the new fields compile and match the fixture', async () => {
    expect(await names(and(LTV_OVER_1000, NO_SHOW_UNDER_20))).toEqual([...sa.expectedHighValueReliable]);
    expect(await names(and(LTV_OVER_1000))).toEqual(['John Doe', 'Ray Park']);
    expect(await names(and({ type: 'ltv', currency: 'USD', op: 'gte', amountMinor: 180_000 }))).toEqual([
      'John Doe',
    ]);
    expect(await names(and({ type: 'ltv', currency: 'EUR', op: 'gt', amountMinor: 0 }))).toEqual([]);
    expect(await names(and(NO_SHOW_UNDER_20))).toEqual(['John Doe', 'Ray Park']);
    expect(await names(and({ type: 'stats', metric: 'noShowPct', op: 'gte', value: 40 }))).toEqual([
      'Mia Lane',
    ]);
    expect(await names(and({ type: 'stats', metric: 'sessionsAttended', op: 'gte', value: 4 }))).toEqual([
      'John Doe',
    ]);
    expect(await names(and({ type: 'stats', metric: 'campaignsOpened', op: 'gt', value: 0 }))).toEqual([
      'John Doe',
    ]);
    expect(await names(and({ type: 'stats', metric: 'engagement', op: 'gte', value: 60 }))).toEqual([
      'John Doe',
    ]);
    expect(await names(and({ type: 'stats', metric: 'rfmFrequency', op: 'eq', value: 1 }))).toEqual([
      'Ray Park',
      'Zoe Hart',
    ]);
    expect(await names(and({ type: 'stats', metric: 'rfmMonetary', op: 'gte', value: 4 }))).toEqual([
      'John Doe',
    ]);
    // Out-of-range values are refused by the DSL.
    await expect(
      preview(and({ type: 'stats', metric: 'noShowPct', op: 'lt', value: 120 })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      preview(and({ type: 'stats', metric: 'rfmRecency', op: 'lt', value: 6 })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('money stays with finance: queries, previews, saves and exports', async () => {
    const marketer = uuidv7();
    const finance = uuidv7();
    const manager = uuidv7();
    await executeCommand(addMemberCommand, { userId: marketer, role: 'marketing' }, a.ctx(), ports);
    await executeCommand(addMemberCommand, { userId: finance, role: 'finance' }, a.ctx(), ports);
    await executeCommand(addMemberCommand, { userId: manager, role: 'manager' }, a.ctx(), ports);
    const m = userCtx(marketer, a.orgId);
    const f = userCtx(finance, a.orgId);
    const g = userCtx(manager, a.orgId);
    // Stats without money: contacts:read (marketing, manager); finance has no contacts:read.
    await expect(
      executeQuery(contactStatsQuery, { contactId: sa.people.john.id }, m, ports),
    ).resolves.toMatchObject({ engagementScore: 64 });
    await expect(
      executeQuery(contactStatsQuery, { contactId: sa.people.john.id }, f, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Money: finance:read only.
    for (const ctx of [m, g])
      await expect(
        executeQuery(contactValueQuery, { contactId: sa.people.john.id }, ctx, ports),
      ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(orgValueQuery, {}, m, ports)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(contactValueQuery, { contactId: sa.people.john.id }, f, ports),
    ).resolves.toMatchObject({
      lifetime: [{ currency: 'USD', amountMinor: 180_000 }],
    });
    // Segments on money: refused without finance (preview and save), allowed without money.
    const money = and(LTV_OVER_1000, NO_SHOW_UNDER_20);
    for (const ctx of [m, g])
      await expect(preview(money, ctx)).rejects.toMatchObject({
        code: 'forbidden',
        details: { reason: 'finance' },
      });
    await expect(
      preview(and({ type: 'stats', metric: 'rfmMonetary', op: 'gte', value: 1 }), m),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(saveSegmentCommand, { name: `Money ${tag}`, definition: money }, m, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await names(and(NO_SHOW_UNDER_20), m)).toEqual(['John Doe', 'Ray Park']);
    // The owner saves it; a manager's export of the saved audience is refused too.
    const saved = await executeCommand(
      saveSegmentCommand,
      { name: `Money ${tag}`, definition: money },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        audienceExportBulk.start,
        { selection: { filter: { segmentId: saved.id } }, params: EXPORT },
        g,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'finance' } });
    // The owner (finance access) may export it.
    const { operationId, total } = await executeCommand(
      audienceExportBulk.start,
      { selection: { filter: { segmentId: saved.id } }, params: EXPORT },
      a.ctx(),
      ports,
    );
    expect(total).toBe(2);
    await runBulk(a.orgId, operationId);
  });

  it('org stats: totals and distributions, money for finance only', async () => {
    const o = await executeQuery(orgContactStatsQuery, {}, b.ctx(), ports);
    expect(o).toMatchObject({
      contacts: 4,
      withActivity: 4,
      participants: 4,
      attendedAny: 2,
      eventsRegistered: 7,
      eventsAttended: 3,
      sessionsAttended: 4,
      campaignsOpened: 2,
      // John 64, Ray 29, Mia 0, Zoe 0 → 23.25 → 23.
      averageEngagement: 23,
      // Past registrations: John 2, Mia 2, Ray 1 → 2 no-shows of 5.
      noShowRateBps: 4_000,
    });
    expect(o.engagement).toEqual([
      { from: 0, count: 2 },
      { from: 20, count: 1 },
      { from: 40, count: 0 },
      { from: 60, count: 1 },
      { from: 80, count: 0 },
    ]);
    expect(o.noShow.map((x) => x.count)).toEqual([0, 2, 1, 1, 0]);
    expect(o.frequency.map((x) => x.count)).toEqual([2, 1, 1, 0]);
    expect(o.recency.reduce((n, x) => n + x.count, 0)).toBe(4);
    const v = await executeQuery(orgValueQuery, {}, b.ctx(), ports);
    expect(v.currencies).toEqual([
      {
        currency: 'USD',
        payers: 4,
        totalMinor: 180_000 + 70_000 + 120_000 + 30_000,
        averageMinor: 100_000,
        topFifthFromMinor: 180_000,
        maxMinor: 180_000,
      },
    ]);
  });

  it('a data-subject export includes the scores and their signals', async () => {
    const out = await withTenant(sys(a.orgId), (tx) => contactDsarTx(tx, sa.people.john.email));
    expect(out.scores).toHaveLength(1);
    expect(out.scores[0]).toMatchObject({ engagementScore: 64, noShowBps: 1_429, sessionsAttended: 4 });
    expect(out.signals.map((g) => g.kind).sort()).toEqual([
      'campaign_opened',
      'campaign_opened',
      'session_attended',
      'session_attended',
      'session_attended',
      'session_attended',
    ]);
    expect(out.stats).toEqual([expect.objectContaining({ currency: 'USD', spendMinor: 180_000 })]);
  });

  it('isolation: one org never sees another org’s stats', async () => {
    await expect(
      executeQuery(contactStatsQuery, { contactId: sb.people.john.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(contactValueQuery, { contactId: sb.people.john.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const seen = await withTenant(sys(a.orgId), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from crm.contact_scores where contact_id = ${sb.people.john.id}`,
      ),
    );
    expect(seen[0]?.n).toBe(0);
    // A's segment never matches B's people (RFM ranks only A's contacts).
    const all = await preview(and({ type: 'stats', metric: 'rfmFrequency', op: 'gte', value: 1 }));
    expect(all.rows.map((r) => r.contactId)).not.toContain(sb.people.john.id);
    expect(all.count).toBe(4);
  });
});

const EXPORT = {
  headers: {
    name: 'Name',
    email: 'Email',
    events: 'Events',
    eventsAttended: 'Attended',
    tickets: 'Tickets',
    firstSeen: 'First seen',
    lastSeen: 'Last seen',
    emailConsent: 'Email consent',
    smsConsent: 'SMS consent',
  },
  consent: { granted: 'Yes', withdrawn: 'Withdrawn', unknown_legacy: 'Unknown', none: 'No' },
};
