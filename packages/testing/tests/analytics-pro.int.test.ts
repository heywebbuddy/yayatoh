import { acknowledgeAlertCommand, catchUpAlerts, evaluateOrgNow, listAlertsQuery } from '@yayatoh/alerts';
import {
  type AnalyticsWarehouse,
  createAlertRuleCommand,
  createReportScheduleCommand,
  deleteAlertRuleCommand,
  deleteReportScheduleCommand,
  deleteViewCommand,
  EXPLORE_CSV_COLUMNS,
  type ExploreDto,
  evaluateAlertRulesTx,
  exploreCsv,
  exploreMoneyQuery,
  exploreQuery,
  explorerQueries,
  fakeTinybird,
  listAlertRulesQuery,
  listReportRunsQuery,
  listReportSchedulesQuery,
  listSavedViewsQuery,
  periodContaining,
  postgresWarehouse,
  type ReportDeps,
  reportFileQuery,
  runDueReports,
  runReportPeriod,
  saveViewCommand,
  setAlertRuleEnabledCommand,
  setReportScheduleEnabledCommand,
  syncEventTx,
  tinybirdWarehouse,
  updateAlertRuleCommand,
  updateReportScheduleCommand,
} from '@yayatoh/analytics';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { type Ctx, executeCommand, executeQuery, uuidv7, zonedTimeToUtc } from '@yayatoh/kernel';
import { createNotifier, dispatchDue, memoryTransports } from '@yayatoh/notifications';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_FIXTURE as F,
  type AttributionScenario,
  attributionScenario,
  type OrgFixture,
  ports,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M6.2b: multi-touch attribution (hand-computed, all three models, both warehouse adapters),
 * the curated explorer (finance gating, saved views, CSV), organizer alert rules on the M3.2b
 * engine (fire, update, resolve, quiet hours, permissions) and scheduled PDF reports (once per
 * period through retries, restarts and concurrent ticks; per-locale and finance variants).
 * Two orgs never see each other's rows.
 */

let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;
let s: AttributionScenario;
let financeId: string;
let managerId: string;
let scannerId: string;
let tz: string;

const owner = () => a.ctx();
const as = (userId: string, f: OrgFixture = a, now?: Date) => userCtx(userId, f.org.id, now ? { now } : {});

const explore = (input: Record<string, unknown>, ctx: Ctx = owner(), q = exploreQuery) =>
  executeQuery(q, { eventId: s.eventId, ...input }, ctx, ports) as Promise<ExploreDto>;
const exploreMoney = (input: Record<string, unknown>, ctx: Ctx = owner(), q = exploreMoneyQuery) =>
  executeQuery(q, { eventId: s.eventId, ...input }, ctx, ports) as Promise<ExploreDto>;
const byKey = (d: ExploreDto) => Object.fromEntries(d.rows.map((r) => [r.key, r.value]));

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  admin = adminClient();
  s = await attributionScenario(a.org.id);
  await attributionScenario(b.org.id);
  financeId = uuidv7();
  managerId = uuidv7();
  scannerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
  await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
  await executeCommand(addMemberCommand, { userId: scannerId, role: 'scanner' }, a.ctx(), ports);
  const [o] = await admin<{ timezone: string }[]>`select timezone from tenancy.organizations where id = ${a.org.id}`;
  tz = o?.timezone ?? 'UTC';
}, 600_000);

afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('multi-touch attribution (hand-computed, to the cent)', () => {
  it('records each order’s touch path in time order', async () => {
    const rows = await admin<{ order_id: string; position: number; kind: string; source: string }[]>`
      select order_id, position, kind, source from marketing.attribution_touches
      where org_id = ${a.org.id} and order_id in ${admin(s.orders as string[])} order by order_id, position`;
    const path = (i: number) =>
      rows.filter((r) => r.order_id === s.orders[i]).map((r) => `${r.kind}:${r.source}`);
    expect(path(0)).toEqual(['click:yayatoh', 'click:instagram', 'click:partner-news']);
    expect(path(1)).toEqual(['click:instagram', 'click:yayatoh']);
    expect(path(2)).toEqual(['utm:podcast', 'referral:google.com']);
    expect(path(3)).toEqual([]);
  });

  for (const model of ['first', 'last', 'linear'] as const)
    it(`${model}: revenue and orders by source match the hand-computed numbers`, async () => {
      const revenue = await exploreMoney({ measure: 'attributed_revenue', dimension: 'source', model });
      expect(revenue.unit).toBe('minor');
      expect(revenue.rows.every((r) => r.currency === 'USD')).toBe(true);
      expect(byKey(revenue)).toEqual(F.revenue[model]);
      expect(revenue.totals).toEqual([{ currency: 'USD', value: F.attributedMinor }]);
      const orders = await explore({ measure: 'attributed_orders', dimension: 'source', model });
      expect(orders.unit).toBe('order_bps');
      expect(byKey(orders)).toEqual(F.orders[model]);
      expect(orders.totals).toEqual([{ currency: null, value: 30_000 }]);
    });

  it('linear by channel and campaign; campaign labels; by period and event', async () => {
    const channel = await exploreMoney({ measure: 'attributed_revenue', dimension: 'channel', model: 'linear' });
    expect(byKey(channel)).toEqual(F.linearByChannel);
    const campaign = await exploreMoney({ measure: 'attributed_revenue', dimension: 'campaign', model: 'linear' });
    expect(byKey(campaign)).toEqual({
      [`c.${s.campaignId}`]: 1333,
      'u.autumn-social': 1333,
      'u.partner': 334,
      'u.autumn-pod': 500,
      '': 500,
    });
    const labels = Object.fromEntries(campaign.rows.map((r) => [r.key, r.label]));
    expect(labels[`c.${s.campaignId}`]).toBeNull(); // the web names messaging campaigns (M3.6b)
    expect(labels['u.autumn-social']).toBe('autumn-social');
    expect(labels['']).toBeNull();
    const period = await exploreMoney({ measure: 'attributed_revenue', dimension: 'period', model: 'first' });
    expect(period.rows).toHaveLength(30);
    expect(period.rows.reduce((t, r) => t + r.value, 0)).toBe(F.attributedMinor);
    const event = await exploreMoney({ measure: 'attributed_revenue', dimension: 'event', model: 'last' });
    expect(event.rows).toEqual([{ key: s.eventId, label: s.eventName, currency: 'USD', value: F.attributedMinor }]);
    // Everything sold, attributed or not: gross by event.
    const gross = await exploreMoney({ measure: 'gross', dimension: 'event' });
    expect(gross.rows).toEqual([{ key: s.eventId, label: s.eventName, currency: 'USD', value: F.soldMinor }]);
  });

  it('the Tinybird adapter (fake) gives the same answers, every query scoped to the org', async () => {
    const tb = fakeTinybird();
    const wh: AnalyticsWarehouse = tinybirdWarehouse({ ...tb.config, fetch: tb.fetch });
    const ctx = systemCtx(a.org.id);
    await withTenant(ctx, (tx) => syncEventTx({ ctx, tx }, wh, s.eventId));
    const q = explorerQueries(wh);
    for (const model of ['first', 'last', 'linear'] as const) {
      const pg = await exploreMoney({ measure: 'attributed_revenue', dimension: 'source', model });
      const tbd = await exploreMoney({ measure: 'attributed_revenue', dimension: 'source', model }, owner(), q.exploreMoneyQuery);
      expect(tbd.rows).toEqual(pg.rows);
      const orders = await explore({ measure: 'attributed_orders', dimension: 'campaign', model }, owner(), q.exploreQuery);
      expect(orders.rows).toEqual((await explore({ measure: 'attributed_orders', dimension: 'campaign', model })).rows);
    }
    tb.assertEveryQueryScoped();
    await admin`delete from analytics.event_sync where adapter = 'tinybird' and org_id = ${a.org.id}`;
  });

  it('isolation: the other org’s event is not found and its rollups are invisible', async () => {
    await expect(
      explore({ measure: 'attributed_orders', dimension: 'source' }, b.ctx()),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [seen] = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from analytics.attribution_rollups where org_id = ${a.org.id}::uuid`,
      ),
    );
    expect(seen?.n).toBe(0);
    const [touches] = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from marketing.attribution_touches where org_id = ${a.org.id}::uuid`,
      ),
    );
    expect(touches?.n).toBe(0);
    // B's own scenario is attributed in B only: A's org-wide totals hold A's rows only.
    const [rows] = await admin<{ orgs: number }[]>`
      select count(distinct org_id)::int as orgs from analytics.attribution_rollups where event_id = ${s.eventId}`;
    expect(rows?.orgs).toBe(1);
  });

  it('a backfill after live ingest changes nothing (attribution included)', async () => {
    const before = await admin<{ id: string; xmin: string }[]>`
      select id, xmin::text from analytics.attribution_rollups where org_id = ${a.org.id} and event_id = ${s.eventId} order by id`;
    const ctx = systemCtx(a.org.id);
    const r = await withTenant(ctx, (tx) => syncEventTx({ ctx, tx }, postgresWarehouse, s.eventId));
    expect(r.written).toBe(false);
    const after = await admin<{ id: string; xmin: string }[]>`
      select id, xmin::text from analytics.attribution_rollups where org_id = ${a.org.id} and event_id = ${s.eventId} order by id`;
    expect(after).toEqual(before);
  });
});

describe('explorer: finance gating, validation, saved views, CSV', () => {
  it('money only for finance: viewers and managers are refused; counts work', async () => {
    const viewer = as(a.viewerId);
    await expect(
      exploreMoney({ measure: 'attributed_revenue', dimension: 'source' }, viewer),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(exploreMoney({ measure: 'gross', dimension: 'period' }, as(managerId))).rejects.toMatchObject({
      code: 'forbidden',
    });
    // The counts query does not take money measures at all.
    await expect(
      explore({ measure: 'attributed_revenue', dimension: 'source' }, viewer),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const counts = await explore({ measure: 'attributed_orders', dimension: 'source', model: 'linear' }, viewer);
    expect(byKey(counts)).toEqual(F.orders.linear);
    const fin = await exploreMoney({ measure: 'net', dimension: 'period', granularity: 'month' }, as(financeId));
    expect(fin.rows.every((r) => r.currency === 'USD')).toBe(true);
    await expect(explore({ measure: 'registrations', dimension: 'period' }, as(scannerId))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('closed vocabulary and validation', async () => {
    await expect(explore({ measure: 'registrations', dimension: 'source' })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'touch_dimension' },
    });
    await expect(explore({ measure: 'registrations', dimension: 'period', range: 'custom' })).rejects.toMatchObject({
      details: { reason: 'custom_needs_dates' },
    });
    await expect(
      explore({ measure: 'registrations', dimension: 'period', range: 'custom', from: '2027-02-01', to: '2027-01-01' }),
    ).rejects.toMatchObject({ details: { reason: 'from_after_to' } });
    await expect(explore({ measure: 'sql', dimension: 'period' })).rejects.toMatchObject({ code: 'validation_failed' });
    const regs = await explore({ measure: 'registrations', dimension: 'event' });
    expect(regs.rows).toEqual([{ key: s.eventId, label: s.eventName, currency: null, value: 4 }]);
    const tickets = await explore({ measure: 'tickets', dimension: 'period', granularity: 'month', range: '7d' });
    expect(tickets.rows.reduce((t, r) => t + r.value, 0)).toBe(5);
  });

  it('saved views are private to their member; names unique; money views need finance', async () => {
    const view = {
      name: `Linear by source ${uuidv7().slice(-6)}`,
      measure: 'attributed_orders',
      dimension: 'source',
      model: 'linear',
      range: '90d',
    };
    const mine = await executeCommand(saveViewCommand, view, as(a.viewerId), ports);
    expect(mine).toMatchObject({ measure: 'attributed_orders', model: 'linear', range: '90d', from: null });
    await expect(executeCommand(saveViewCommand, { ...view, name: view.name.toUpperCase() }, as(a.viewerId), ports)).rejects.toMatchObject({
      code: 'conflict',
    });
    // Another member may use the same name; neither sees the other's.
    await executeCommand(saveViewCommand, view, as(managerId), ports);
    const viewerViews = await executeQuery(listSavedViewsQuery, {}, as(a.viewerId), ports);
    expect(viewerViews.map((v) => v.id)).toEqual([mine.id]);
    await expect(executeCommand(deleteViewCommand, { viewId: mine.id }, as(managerId), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(saveViewCommand, { ...view, name: 'Money', measure: 'gross', dimension: 'period' }, as(a.viewerId), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(saveViewCommand, { ...view, name: 'Bad', measure: 'checkins', dimension: 'campaign' }, as(a.viewerId), ports),
    ).rejects.toMatchObject({ details: { reason: 'touch_dimension' } });
    await expect(
      executeCommand(saveViewCommand, { ...view, name: 'Custom', range: 'custom', from: '2027-01-01' }, as(a.viewerId), ports),
    ).rejects.toMatchObject({ details: { reason: 'custom_needs_dates' } });
    const custom = await executeCommand(
      saveViewCommand,
      { ...view, name: 'Custom', measure: 'gross', dimension: 'event', range: 'custom', from: '2027-01-01', to: '2027-01-31' },
      as(financeId),
      ports,
    );
    expect(custom).toMatchObject({ from: '2027-01-01', to: '2027-01-31', model: null });
    await executeCommand(deleteViewCommand, { viewId: mine.id }, as(a.viewerId), ports);
    expect(await executeQuery(listSavedViewsQuery, {}, as(a.viewerId), ports)).toEqual([]);
    // Org B's member never sees org A's views (RLS).
    const [leak] = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from analytics.saved_views where org_id = ${a.org.id}::uuid`),
    );
    expect(leak?.n).toBe(0);
  });

  it('CSV export through the allowlist serializer', async () => {
    const d = await exploreMoney({ measure: 'attributed_revenue', dimension: 'source', model: 'linear' });
    const csv = exploreCsv(d, { dimension: 'Source', currency: 'Currency', value: 'Revenue' }, (r) => r.label ?? 'None', 'Total');
    const lines = csv.split('\r\n');
    expect(EXPLORE_CSV_COLUMNS).toHaveLength(3);
    expect(lines[0]).toBe('﻿Source,Currency,Revenue');
    expect(lines).toContain('instagram,USD,13.33');
    expect(lines).toContain('partner-news,USD,3.34');
    expect(lines).toContain('Total,USD,40.00');
  });
});

/** Outbox events the alerts subscriber has not seen yet, applied as the worker would. */
async function deliverAlerts() {
  await catchUpAlerts(a.org.id, { notifier: createNotifier() });
}
const ruleAlerts = async (ctx: Ctx = owner()) =>
  (await executeQuery(listAlertsQuery, { status: 'active' }, ctx, ports)).filter((x) => x.rule.startsWith('metricRule'));

describe('organizer alert rules on the M3.2b engine', () => {
  it('fires, updates, resolves and reopens through the outbox; sent once per change', async () => {
    const name = `Registrations at ${uuidv7().slice(-6)}`;
    const rule = await executeCommand(
      createAlertRuleCommand,
      { name, measure: 'registrations', condition: 'above', threshold: 3, windowDays: 1, eventId: s.eventId },
      owner(),
      ports,
    );
    expect(rule).toMatchObject({ state: 'firing', lastValue: 4, enabled: true, quietHours: true });
    await deliverAlerts();
    const [alert] = (await ruleAlerts()).filter((x) => x.title === name);
    expect(alert).toMatchObject({ rule: 'metricRule', state: 'open', count: 4, severity: 'warning', fixPath: '/analytics/alerts' });
    expect(alert?.params).toMatchObject({ value: 4, threshold: 3, windowDays: 1 });
    const sent = () =>
      admin<{ kind: string; channel: string }[]>`
        select kind, channel from notifications.messages where org_id = ${a.org.id} and dedupe_key like ${`alert:${alert?.id}:%`}`;
    const first = await sent();
    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first.map((m) => m.kind))).toEqual(new Set(['alerts.metric']));
    expect(first.some((m) => m.channel === 'sms')).toBe(false);
    // Evaluating again with nothing new emits nothing and sends nothing.
    const again = await withTenant(systemCtx(a.org.id), (tx) => evaluateAlertRulesTx(systemCtx(a.org.id), tx));
    expect(again.emitted).toBe(0);
    await deliverAlerts();
    expect(await sent()).toHaveLength(first.length);
    // A higher threshold clears it: the alert resolves.
    await executeCommand(
      updateAlertRuleCommand,
      { ruleId: rule.id, name, measure: 'registrations', condition: 'above', threshold: 10, windowDays: 1, eventId: s.eventId },
      owner(),
      ports,
    );
    await deliverAlerts();
    expect((await ruleAlerts()).some((x) => x.title === name)).toBe(false);
    // Back under the old threshold: reopened (same alert row), sent again.
    await executeCommand(
      updateAlertRuleCommand,
      {
        ruleId: rule.id,
        name,
        measure: 'registrations',
        condition: 'above',
        threshold: 2,
        windowDays: 1,
        eventId: s.eventId,
        severity: 'critical',
        quietHours: false,
      },
      owner(),
      ports,
    );
    await deliverAlerts();
    const [reopened] = (await ruleAlerts()).filter((x) => x.title === name);
    expect(reopened).toMatchObject({ id: alert?.id, reopenCount: 1, severity: 'critical' });
    expect((await sent()).some((m) => m.kind === 'alerts.metric-now')).toBe(true);
    // Switched off: resolved.
    await executeCommand(setAlertRuleEnabledCommand, { ruleId: rule.id, enabled: false }, owner(), ports);
    await deliverAlerts();
    expect((await ruleAlerts()).some((x) => x.title === name)).toBe(false);
    const listed = await executeQuery(listAlertRulesQuery, {}, owner(), ports);
    expect(listed.find((r) => r.id === rule.id)).toMatchObject({ enabled: false, state: null });
  });

  it('quiet hours in the recipient’s time zone: email waits; without quiet hours it goes at once', async () => {
    const quiet = await executeCommand(
      createAlertRuleCommand,
      { name: `Quiet ${uuidv7().slice(-6)}`, measure: 'tickets', condition: 'above', threshold: 1, windowDays: 7, eventId: s.eventId },
      owner(),
      ports,
    );
    await deliverAlerts();
    const [alert] = (await ruleAlerts()).filter((x) => x.title === quiet.name);
    // 23:30 in the org's (and so the recipients') time zone.
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const night = zonedTimeToUtc(`${local}T23:30`, tz);
    await admin`update notifications.messages set send_after = ${night}::timestamptz - interval '1 minute'
      where org_id = ${a.org.id} and dedupe_key like ${`alert:${alert?.id}:%`}`;
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, {
      transports,
      appOrigin: 'https://app.yayatoh.test',
      now: () => night,
      userEmails: async (ids) => new Map(ids.map((id) => [id, `${id.slice(-6)}@members.test`])),
    });
    expect(emails.filter((m) => m.subject.includes(quiet.name))).toHaveLength(0);
    const held = await admin<{ reason: string | null }[]>`
      select reason from notifications.messages where org_id = ${a.org.id} and channel = 'email'
        and dedupe_key like ${`alert:${alert?.id}:%`}`;
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((h) => h.reason === 'quiet_hours')).toBe(true);
    await executeCommand(deleteAlertRuleCommand, { ruleId: quiet.id }, owner(), ports);
    await deliverAlerts();
    expect((await ruleAlerts()).some((x) => x.title === quiet.name)).toBe(false);
  });

  it('an acknowledged rule alert still firing opens again after the timeout (the sweep)', async () => {
    const r = await executeCommand(
      createAlertRuleCommand,
      { name: `Sweep ${uuidv7().slice(-6)}`, measure: 'checkins', condition: 'below', threshold: 5, windowDays: 30, eventId: s.eventId },
      owner(),
      ports,
    );
    await deliverAlerts();
    const [alert] = (await ruleAlerts()).filter((x) => x.title === r.name);
    await executeCommand(acknowledgeAlertCommand, { alertId: alert?.id as string }, owner(), ports);
    await evaluateOrgNow(a.org.id, { notifier: createNotifier() }, { now: new Date(Date.now() + 61 * 60_000) });
    const [after] = (await ruleAlerts()).filter((x) => x.title === r.name);
    expect(after?.state).toBe('open');
    await executeCommand(deleteAlertRuleCommand, { ruleId: r.id }, owner(), ports);
    await deliverAlerts();
  });

  it('permissions and validation: managers write count rules, money rules need finance and stay hidden', async () => {
    const base = { measure: 'registrations', condition: 'above', threshold: 1, windowDays: 7 };
    await expect(
      executeCommand(createAlertRuleCommand, { ...base, name: 'Viewer' }, as(a.viewerId), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const m = await executeCommand(createAlertRuleCommand, { ...base, name: `Manager ${uuidv7().slice(-6)}` }, as(managerId), ports);
    await expect(
      executeCommand(createAlertRuleCommand, { ...base, name: 'Money', measure: 'gross', currency: 'USD' }, as(managerId), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const money = await executeCommand(
      createAlertRuleCommand,
      { ...base, name: `Refunds ${uuidv7().slice(-6)}`, measure: 'refunds', condition: 'above', threshold: 100_000, currency: 'USD' },
      as(financeId),
      ports,
    );
    expect((await executeQuery(listAlertRulesQuery, {}, as(managerId), ports)).some((r) => r.id === money.id)).toBe(false);
    expect((await executeQuery(listAlertRulesQuery, {}, as(financeId), ports)).some((r) => r.id === money.id)).toBe(true);
    await expect(
      executeCommand(createAlertRuleCommand, { ...base, name: 'No currency', measure: 'net' }, as(financeId), ports),
    ).rejects.toMatchObject({ details: { reason: 'currency_required' } });
    await expect(
      executeCommand(createAlertRuleCommand, { ...base, name: 'Huge', condition: 'rise', threshold: 5000 }, owner(), ports),
    ).rejects.toMatchObject({ details: { reason: 'percent_range' } });
    await expect(
      executeCommand(createAlertRuleCommand, { ...base, name: m.name.toLowerCase() }, owner(), ports),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      executeCommand(createAlertRuleCommand, { ...base, name: 'Window', windowDays: 3 }, owner(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Org B cannot touch org A's rule.
    await expect(
      executeCommand(setAlertRuleEnabledCommand, { ruleId: m.id, enabled: false }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(deleteAlertRuleCommand, { ruleId: m.id }, owner(), ports);
    await executeCommand(deleteAlertRuleCommand, { ruleId: money.id }, as(financeId), ports);
  });
});

/** A renderer that records what it rendered (and can fail on demand). */
function fakeRenderer() {
  const html: string[] = [];
  let failNext = 0;
  return {
    html,
    failTimes: (n: number) => {
      failNext = n;
    },
    renderer: {
      render: async (input: { html: string }) => {
        if (failNext > 0) {
          failNext -= 1;
          throw new Error('gotenberg: 503 busy');
        }
        html.push(input.html);
        return new TextEncoder().encode(`%PDF-1.7 ${html.length}`);
      },
    },
  };
}

describe('scheduled PDF reports', () => {
  const deps = (r: ReturnType<typeof fakeRenderer>, locales: Record<string, string> = {}): ReportDeps => ({
    notifier: createNotifier(),
    renderer: r.renderer,
    userLocales: async (ids) => new Map(ids.map((id) => [id, locales[id] ?? null])),
  });
  const messages = (scheduleId: string) =>
    admin<{ kind: string; channel: string; user: string; key: string }[]>`
      select kind, channel, recipient_user_id::text as user, split_part(dedupe_key, ':', 3) as key
      from notifications.messages
      where org_id = ${a.org.id} and dedupe_key like ${`report:${scheduleId}:%`} order by 3, 2`;

  it('owners and admins only; recipients must be members who read orders', async () => {
    const base = { name: `Weekly ${uuidv7().slice(-6)}`, frequency: 'weekly', recipients: [a.ownerId] };
    await expect(executeCommand(createReportScheduleCommand, base, as(managerId), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(createReportScheduleCommand, { ...base, recipients: [scannerId] }, owner(), ports),
    ).rejects.toMatchObject({ details: { reason: 'bad_recipient' } });
    await expect(
      executeCommand(createReportScheduleCommand, { ...base, recipients: [b.ownerId] }, owner(), ports),
    ).rejects.toMatchObject({ details: { reason: 'bad_recipient' } });
    await expect(
      executeCommand(createReportScheduleCommand, { ...base, recipients: [] }, owner(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(createReportScheduleCommand, { ...base, sendHour: 24 }, owner(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const sched = await executeCommand(createReportScheduleCommand, base, owner(), ports);
    expect(sched.nextSendAt).not.toBeNull();
    await expect(executeCommand(createReportScheduleCommand, base, owner(), ports)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await executeQuery(listReportSchedulesQuery, {}, owner(), ports)).some((x) => x.id === sched.id)).toBe(true);
    await expect(executeQuery(listReportSchedulesQuery, {}, as(a.viewerId), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(deleteReportScheduleCommand, { scheduleId: sched.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(deleteReportScheduleCommand, { scheduleId: sched.id }, owner(), ports);
  });

  it('arrives once per period: retries, a restarted worker and concurrent ticks send nothing twice', async () => {
    const r = fakeRenderer();
    const sched = await executeCommand(
      createReportScheduleCommand,
      { name: `Daily ${uuidv7().slice(-6)}`, frequency: 'daily', sendHour: 7, eventId: s.eventId, recipients: [a.ownerId, a.viewerId, financeId] },
      owner(),
      ports,
    );
    // The schedule started "yesterday": today's 07:00 (org time) sends yesterday. The org's other
    // schedules (the fixture's) are off for this test.
    await admin`update analytics.report_schedules set active_since = now() - interval '30 hours' where id = ${sched.id}`;
    await admin`update analytics.report_schedules set enabled = false where org_id = ${a.org.id} and id <> ${sched.id}`;
    const at = new Date(Date.now() + 26 * 3_600_000); // well past the next 07:00
    // The first attempt fails while rendering (Gotenberg busy): nothing is sent, the run waits.
    r.failTimes(1);
    const first = await runDueReports(a.org.id, deps(r, { [a.viewerId]: 'fr' }), at);
    expect(first.failed).toBeGreaterThan(0);
    // The oldest period failed (the others went out on their own).
    const [pending] = await admin<{ key: string; status: string; error: string | null; attempts: number }[]>`
      select period_key as key, status, error, attempts from analytics.report_runs where schedule_id = ${sched.id}
      order by period_key limit 1`;
    expect(pending).toMatchObject({ status: 'pending', attempts: 1 });
    expect(pending?.error).toContain('503');
    expect((await messages(sched.id)).filter((m) => m.key === pending?.key)).toEqual([]);
    // Two workers tick at once (a restart, a duplicated job): one sends, the other finds it sent.
    await Promise.all([
      runDueReports(a.org.id, deps(r, { [a.viewerId]: 'fr' }), at),
      runDueReports(a.org.id, deps(r, { [a.viewerId]: 'fr' }), at),
    ]);
    await runDueReports(a.org.id, deps(r, { [a.viewerId]: 'fr' }), at);
    const runs = await admin<{ period_key: string; status: string; recipients_sent: number }[]>`
      select period_key, status, recipients_sent from analytics.report_runs where schedule_id = ${sched.id} order by period_key`;
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(new Set(runs.map((x) => x.period_key)).size).toBe(runs.length);
    expect(runs.every((x) => x.status === 'sent' && x.recipients_sent === 3)).toBe(true);
    const msgs = await messages(sched.id);
    const emails = msgs.filter((m) => m.channel === 'email');
    expect(emails).toHaveLength(3 * runs.length);
    expect(new Set(msgs.map((m) => m.kind))).toEqual(new Set(['analytics.report']));
    // One PDF per language and revenue visibility: en with revenue (owner, finance), fr without.
    const files = await admin<{ locale: string; finance: boolean }[]>`
      select distinct f.locale, f.finance from analytics.report_files f join analytics.report_runs r on r.id = f.run_id
      where r.schedule_id = ${sched.id} order by 1, 2`;
    expect(files).toEqual([
      { locale: 'en', finance: true },
      { locale: 'fr', finance: false },
    ]);
    const fr = r.html.find((h) => h.includes('lang="fr"'));
    expect(fr).toContain('Inscriptions');
    expect(fr).not.toContain('Revenus');
    expect(r.html.find((h) => h.includes('lang="en"'))).toContain('Revenue');
    // Members open their own PDF; the viewer can't open the finance one.
    const viewerRuns = await executeQuery(listReportRunsQuery, { locale: 'fr' }, as(a.viewerId), ports);
    const vr = viewerRuns.find((x) => x.scheduleId === sched.id);
    expect(vr?.fileId).toBeTruthy();
    const pdf = await executeQuery(reportFileQuery, { fileId: vr?.fileId as string }, as(a.viewerId), ports);
    expect(new TextDecoder().decode(pdf.pdf)).toMatch(/^%PDF-1\.7/);
    const ownerRuns = await executeQuery(listReportRunsQuery, {}, owner(), ports);
    const financeFile = ownerRuns.find((x) => x.scheduleId === sched.id)?.fileId as string;
    await expect(executeQuery(reportFileQuery, { fileId: financeFile }, as(a.viewerId), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(executeQuery(reportFileQuery, { fileId: financeFile }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // A period sent is never sent again, even run directly.
    const period = periodContaining('daily', runs[0]?.period_key.slice(1) as string);
    expect(await runReportPeriod(a.org.id, sched.id, period, deps(r), at)).toBe('skipped');
    expect(await messages(sched.id)).toHaveLength(msgs.length);
    // Switched off: nothing more.
    await executeCommand(setReportScheduleEnabledCommand, { scheduleId: sched.id, enabled: false }, owner(), ports);
    const later = await runDueReports(a.org.id, deps(r), new Date(at.getTime() + 3 * 86_400_000));
    expect(later.sent).toBe(0);
    await executeCommand(
      updateReportScheduleCommand,
      { scheduleId: sched.id, name: 'Renamed', frequency: 'weekly', recipients: [a.ownerId] },
      owner(),
      ports,
    );
  });

  it('DST: a daily report in Europe/Berlin across the spring change sends each day once', async () => {
    const r = fakeRenderer();
    const prevTz = tz;
    await admin`update tenancy.organizations set timezone = 'Europe/Berlin' where id = ${a.org.id}`;
    try {
      const sched = await executeCommand(
        createReportScheduleCommand,
        { name: `Berlin ${uuidv7().slice(-6)}`, frequency: 'daily', sendHour: 2, recipients: [a.ownerId] },
        owner(),
        ports,
      );
      // Started at 03:00 on Mar 26 (Berlin): the first period it sends is Mar 26 itself.
      await admin`update analytics.report_schedules set active_since = '2027-03-26T02:00:00Z' where id = ${sched.id}`;
      await admin`update analytics.report_schedules set enabled = false where org_id = ${a.org.id} and id <> ${sched.id}`;
      for (let t = Date.parse('2027-03-26T00:00:00Z'); t <= Date.parse('2027-03-30T12:00:00Z'); t += 50 * 60_000)
        await runDueReports(a.org.id, deps(r), new Date(t));
      const runs = await admin<{ period_key: string; sent_at: Date }[]>`
        select period_key, sent_at from analytics.report_runs where schedule_id = ${sched.id} order by period_key`;
      expect(runs.map((x) => x.period_key)).toEqual(['D2027-03-26', 'D2027-03-27', 'D2027-03-28', 'D2027-03-29']);
      const emails = (await messages(sched.id)).filter((m) => m.channel === 'email');
      expect(emails).toHaveLength(4);
      await executeCommand(deleteReportScheduleCommand, { scheduleId: sched.id }, owner(), ports);
    } finally {
      await admin`update tenancy.organizations set timezone = ${prevTz} where id = ${a.org.id}`;
    }
  });
});
