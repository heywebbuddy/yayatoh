import { evaluateOrgNow, listAlertsQuery } from '@yayatoh/alerts';
import { campaignsWidget, deliverabilityWidget } from '@yayatoh/command-center';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { assignEventRoleCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  ANALYTICS_CSV_COLUMNS,
  analyticsCsv,
  analyticsReportQuery,
  campaignDetailQuery,
  createTrackedLinkCommand,
  deliverabilityReportQuery,
} from '@yayatoh/marketing';
import {
  createNotifier,
  dispatchDue,
  evaluateComplaintRateTx,
  memoryTransports,
} from '@yayatoh/notifications';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bareOrg,
  MARKETING_FIXTURE as F,
  type MarketingScenario,
  marketingScenario,
  type OrgFixture,
  ports,
  seedEmails,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M3.8b marketing analytics: campaign → registrations and revenue (first and last touch, exact
 * fixture numbers), date ranges in the org's zone, the campaign drill-down and CSV, deliverability
 * per org / sending domain / campaign raising and resolving the M3.2b alert, the Command Center
 * tiles (the door never gets revenue), permissions and isolation.
 */

let m: Awaited<ReturnType<typeof bareOrg>>;
let b: OrgFixture;
let viewerId: string;
let s: MarketingScenario;
let marketerId: string;
let scannerId: string;
const DAY = 86_400_000;

beforeAll(async () => {
  ({ b } = await twoOrgs());
  m = await bareOrg(`mkt-${uuidv7().slice(-8)}`, 'Meadow Marketing');
  s = await marketingScenario(m.orgId);
  marketerId = uuidv7();
  scannerId = uuidv7();
  viewerId = uuidv7();
  await executeCommand(addMemberCommand, { userId: viewerId, role: 'viewer' }, m.ctx(), ports);
  await executeCommand(addMemberCommand, { userId: marketerId, role: 'marketing' }, m.ctx(), ports);
  await executeCommand(addMemberCommand, { userId: scannerId, role: 'scanner' }, m.ctx(), ports);
}, 120_000);
afterAll(closePools);

const report = (input: Record<string, unknown> = {}, ctx = m.ctx()) =>
  executeQuery(analyticsReportQuery, input, ctx, ports);

describe('campaign → registrations and revenue', () => {
  it('attributes the fixture clicks and orders first and last touch exactly, per campaign', async () => {
    const r = await report({ dimension: 'campaign' });
    expect(r.currency).toBe('USD');
    expect(r.rows.map((x) => [x.kind, x.name])).toEqual([
      ['campaign', F.campaignName],
      ['utm', 'spring-social'],
      ['utm', 'spring-podcast'],
    ]);
    const [campaign, social, podcast] = r.rows;
    expect(campaign).toMatchObject({
      key: `c.${s.campaignId}`,
      sends: F.campaign.sends,
      deliveries: F.campaign.deliveries,
      clicks: F.campaign.clicks,
      uniqueClickers: F.campaign.uniqueClickers,
      firstTouch: { orders: F.campaign.firstTouchOrders, revenueMinor: F.campaign.firstTouchRevenueMinor },
      lastTouch: { orders: F.campaign.lastTouchOrders, revenueMinor: F.campaign.lastTouchRevenueMinor },
      conversionBps: F.campaign.conversionBps,
      otherCurrencyOrders: 0,
    });
    expect(social).toMatchObject({
      key: 'u.spring-social',
      sends: null,
      deliveries: null,
      clicks: F.social.clicks,
      uniqueClickers: F.social.uniqueClickers,
      firstTouch: { orders: 0, revenueMinor: 0 },
      lastTouch: { orders: 1, revenueMinor: 2500 },
      conversionBps: F.social.conversionBps,
    });
    expect(podcast).toMatchObject({
      key: 'u.spring-podcast',
      clicks: 0,
      firstTouch: { orders: 1, revenueMinor: 2500 },
      lastTouch: { orders: 1, revenueMinor: 2500 },
      conversionBps: 0,
    });
    expect(r.totals).toEqual({
      sends: F.totals.sends,
      deliveries: F.totals.deliveries,
      clicks: F.totals.clicks,
      uniqueClickers: F.totals.uniqueClickers,
      firstTouch: { orders: F.totals.orders, revenueMinor: F.totals.revenueMinor },
      lastTouch: { orders: F.totals.orders, revenueMinor: F.totals.revenueMinor },
      otherCurrencyOrders: 0,
      conversionBps: F.totals.conversionBps,
    });
  });

  it('per channel (UTM medium, with the campaign’s sends on its message channel) and per link', async () => {
    const ch = await report({ dimension: 'channel' });
    expect(
      ch.rows.map((x) => [x.name, x.sends, x.clicks, x.firstTouch.orders, x.lastTouch.revenueMinor]),
    ).toEqual([
      ['email', 120, 4, 2, 5000],
      ['social', null, 2, 0, 2500],
      ['audio', null, 0, 1, 2500],
    ]);
    const links = await report({ dimension: 'link' });
    expect(
      links.rows.map((x) => [x.name, x.link?.medium, x.clicks, x.uniqueClickers, x.lastTouch.orders]),
    ).toEqual([
      [F.campaignName, 'email', 4, 3, 1],
      [F.socialLabel, 'social', 2, 2, 1],
    ]);
    expect(links.rows[0]?.link).toMatchObject({ eventName: s.eventName, eventSlug: s.eventSlug });
    // UTM-only orders have no link: the link view's totals still count every order.
    expect(links.totals.lastTouch.orders).toBe(3);
  });

  it('limits to the date range in the org’s time zone, and refuses a bad range', async () => {
    const tz = (await report()).timeZone;
    const day = (ms: number) => new Date(Date.now() + ms).toLocaleDateString('en-CA', { timeZone: tz });
    // Ten to five days ago: none of the fixture's clicks, orders or sends.
    const old = await report({ from: day(-10 * DAY), to: day(-5 * DAY) });
    // Every link still has its row, with zeros.
    expect(old.rows.every((x) => x.clicks === 0 && x.lastTouch.orders === 0 && x.sends === null)).toBe(true);
    expect(old.totals).toMatchObject({ clicks: 0, sends: null, lastTouch: { orders: 0, revenueMinor: 0 } });
    expect(old).toMatchObject({ fromDay: day(-10 * DAY), toDay: day(-5 * DAY) });
    // Two days ago to today: device 1's first click (three days ago) is outside, but the order is
    // inside, so it is still credited first touch to the campaign.
    const recent = await report({ from: day(-2 * DAY), to: day(0) });
    const c = recent.rows.find((x) => x.kind === 'campaign');
    expect(c).toMatchObject({ clicks: 3, firstTouch: { orders: 2 } });
    for (const [input, reason] of [
      [{ from: '2026-02-30', to: '2026-03-01' }, 'invalid_date'],
      [{ from: '2026-03-02', to: '2026-03-01' }, 'from_after_to'],
      [{ from: '2024-01-01', to: '2026-01-01' }, 'range_too_long'],
    ] as const)
      await expect(report(input)).rejects.toMatchObject({ code: 'validation_failed', details: { reason } });
  });

  it('drills into a campaign: figures, links, delivery and the orders it touched', async () => {
    const d = await executeQuery(campaignDetailQuery, { key: `c.${s.campaignId}` }, m.ctx(), ports);
    expect(d).toMatchObject({
      kind: 'campaign',
      name: F.campaignName,
      figures: { clicks: 4, sends: 120, lastTouch: { orders: 1, revenueMinor: 5000 } },
      delivery: {
        channels: ['email'],
        sent: 120,
        delivered: 112,
        bounced: 8,
        bounceBps: 666,
        complaintBps: 0,
      },
    });
    expect(d.links.map((l) => l.link?.id)).toEqual([s.campaignLinkId]);
    expect(Object.fromEntries(d.orders.map((o) => [o.orderId, o.touch]))).toEqual({
      [s.orders.mixed]: 'first',
      [s.orders.campaign]: 'both',
    });
    expect(d.orders.every((o) => o.eventSlug === s.eventSlug && o.status === 'paid')).toBe(true);
    // No buyer detail travels: the DTO is numbers, ids and the event.
    expect(JSON.stringify(d)).not.toMatch(/buyers\.test|Mira|Cam\b/);

    const utm = await executeQuery(campaignDetailQuery, { key: 'u.spring-podcast' }, m.ctx(), ports);
    expect(utm).toMatchObject({ kind: 'utm', delivery: null, links: [] });
    expect(utm.orders).toEqual([expect.objectContaining({ orderId: s.orders.podcast, touch: 'both' })]);
    const social = await executeQuery(campaignDetailQuery, { key: 'u.spring-social' }, m.ctx(), ports);
    expect(social.orders).toEqual([expect.objectContaining({ orderId: s.orders.mixed, touch: 'last' })]);

    for (const key of [`c.${uuidv7()}`, 'u.never-used', 'x.bogus', 'c.not-a-uuid'])
      await expect(executeQuery(campaignDetailQuery, { key }, m.ctx(), ports)).rejects.toMatchObject({
        code: 'not_found',
      });
  });

  it('exports CSV through the allowlist: localized header, one line per row, the totals; formulas neutralised', async () => {
    await executeCommand(
      createTrackedLinkCommand,
      { eventId: s.eventId, source: '=cmd', medium: 'print', campaign: '+flyer', label: '@poster' },
      m.ctx(),
      ports,
    );
    const r = await report({ dimension: 'link' });
    const headers = Object.fromEntries(ANALYTICS_CSV_COLUMNS.map((c) => [c, `H:${c}`])) as Record<
      (typeof ANALYTICS_CSV_COLUMNS)[number],
      string
    >;
    const csv = analyticsCsv(r, headers, { unnamed: 'Unnamed', total: 'Total' });
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe(ANALYTICS_CSV_COLUMNS.map((c) => `H:${c}`).join(','));
    expect(lines).toHaveLength(1 + r.rows.length + 1);
    expect(lines).toContain(
      `${F.campaignName},${s.eventName},yayatoh,email,spring-launch,${r.rows[0]?.link?.code},,,4,3,2,7500,1,5000,0,25.00,USD`,
    );
    expect(lines.at(-1)).toBe('Total,,,,,,120,112,6,4,3,10000,3,10000,0,50.00,USD');
    // The poster link: every formula-like cell starts with a quote.
    expect(lines.find((l) => l.includes('poster'))).toMatch(/^'@poster,[^,]*,'=cmd,print,'\+flyer,/);
    expect(csv).not.toMatch(/buyers\.test|device|hash/i);
  });
});

describe('deliverability', () => {
  it('rates per org, sending domain and campaign against the alert thresholds', async () => {
    const d = await executeQuery(deliverabilityReportQuery, {}, m.ctx(), ports);
    expect(d.thresholds).toEqual({ minSent: 100, bounceBps: 500, complaintBps: 10, windowDays: 7 });
    expect(d.org).toMatchObject({
      sent: F.orgSent,
      bounced: 8,
      bounceBps: F.orgBounceBps,
      bounceOver: false,
    });
    expect(d.domains.map((x) => [x.domain, x.platform, x.sent, x.bounceBps, x.bounceOver])).toEqual([
      ['mail.yayatoh.com', true, 200, 0, false],
      [s.senderDomain, false, 120, F.campaignBounceBps, true],
    ]);
    expect(d.campaigns).toEqual([
      expect.objectContaining({
        campaignId: s.campaignId,
        name: F.campaignName,
        sent: 120,
        bounced: 8,
        bounceBps: F.campaignBounceBps,
        bounceOver: true,
        complaintOver: false,
      }),
    ]);
    expect(d.autoPause).toBeNull();
  });

  it('a campaign and domain over the threshold raise the deliverability alert (linking to the suppression list); it resolves when the window passes', async () => {
    const active = async () =>
      (await executeQuery(listAlertsQuery, { status: 'active' }, m.ctx(), ports)).find(
        (x) => x.rule === 'deliverability',
      );
    const alert = await active();
    expect(alert).toMatchObject({
      severity: 'warning',
      fixPath: '/messaging#suppressions',
      params: expect.objectContaining({ domains: 1, campaigns: 1, bounceBps: F.orgBounceBps, paused: 0 }),
    });
    // Idempotent: evaluating again changes nothing.
    await s.evaluate();
    expect((await active())?.id).toBe(alert?.id);
    // Eight days on, the week's email is behind us: resolved.
    await s.evaluate(new Date(Date.now() + 8 * DAY));
    expect(await active()).toBeUndefined();
    // Back to now: the same alert reopens (one row per rule and scope).
    await s.evaluate();
    expect((await active())?.id).toBe(alert?.id);
  });

  it('under 100 emails a bad rate raises nothing; the complaint auto-pause shows and raises it as critical', async () => {
    const c = await bareOrg(`mkt-pause-${uuidv7().slice(-8)}`, 'Pause Events');
    const ctx = systemCtx(c.orgId);
    await seedEmails(ctx, {
      count: 60,
      bounced: 30,
      campaignId: uuidv7(),
      senderDomain: 'mail.yayatoh.com',
      sentAt: new Date(Date.now() - DAY),
    });
    const scenario = { evaluate: () => evaluateOrgNow(c.orgId, { notifier: createNotifier() }) };
    await scenario.evaluate();
    const alerts = await executeQuery(listAlertsQuery, { status: 'active' }, c.ctx(), ports);
    expect(alerts.find((x) => x.rule === 'deliverability')).toBeUndefined();
    const d0 = await executeQuery(deliverabilityReportQuery, {}, c.ctx(), ports);
    expect(d0.campaigns[0]).toMatchObject({ sent: 60, bounceBps: 5000, enough: false, bounceOver: false });

    // Complaints on optional mail over 0.3 %: M3.5a pauses messaging; the report and alert show it.
    await seedEmails(ctx, {
      count: 200,
      complained: 3,
      campaignId: uuidv7(),
      senderDomain: 'mail.yayatoh.com',
      sentAt: new Date(Date.now() - DAY),
    });
    expect(await withTenant(ctx, (tx) => evaluateComplaintRateTx(tx, ctx, () => {}))).toBe(true);
    const d = await executeQuery(deliverabilityReportQuery, {}, c.ctx(), ports);
    expect(d.autoPause).toMatchObject({ active: true, complaints: 3 });
    await scenario.evaluate();
    const after = await executeQuery(listAlertsQuery, { status: 'active' }, c.ctx(), ports);
    expect(after.find((x) => x.rule === 'deliverability')).toMatchObject({
      severity: 'critical',
      params: expect.objectContaining({ paused: 1 }),
    });
  });

  it('the dispatcher records the sending domain of each email (the org’s verified domain, else the platform sender)', async () => {
    await withTenant(systemCtx(b.org.id), (tx) =>
      createNotifier().enqueue(tx, {
        kind: 'ticketing.holder-link',
        to: { email: 'dom@example.test' },
        params: { url: 'http://localhost:3000/my-tickets/x', eventName: 'Domain Night' },
        dedupeKey: `dom:${uuidv7()}`,
      }),
    );
    const { transports } = memoryTransports();
    const domainOf = async (orgId: string) => {
      await dispatchDue(orgId, { transports, appOrigin: 'http://localhost:3000' });
      const rows = await withTenant(systemCtx(orgId), (tx) =>
        tx.execute<{ sender_domain: string | null }>(
          sql`select sender_domain from notifications.messages where recipient_email = 'dom@example.test' and status = 'sent'`,
        ),
      );
      return rows.map((r) => r.sender_domain);
    };
    // The fixture org has a verified sending domain (M3.5b); the bare org sends from the platform.
    const [verified] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ domain: string }>(
        sql`select domain from notifications.sending_domains where status = 'verified'`,
      ),
    );
    expect(await domainOf(b.org.id)).toEqual([verified?.domain ?? 'mail.yayatoh.com']);
    // (a separate bare org: the fixture's numbers stay exact)
    const other = await bareOrg(`mkt-dom-${uuidv7().slice(-8)}`, 'Domain Events');
    await withTenant(systemCtx(other.orgId), (tx) =>
      createNotifier().enqueue(tx, {
        kind: 'ticketing.holder-link',
        to: { email: 'dom@example.test' },
        params: { url: 'http://localhost:3000/my-tickets/y', eventName: 'Platform Night' },
        dedupeKey: `dom:${uuidv7()}`,
      }),
    );
    expect(await domainOf(other.orgId)).toEqual(['mail.yayatoh.com']);
  });
});

describe('Command Center tiles', () => {
  const tile = (ctx = m.ctx()) => executeQuery(campaignsWidget.loader, { eventId: s.eventId }, ctx, ports);
  const mail = (ctx = m.ctx()) =>
    executeQuery(deliverabilityWidget.loader, { eventId: s.eventId }, ctx, ports);

  it('the campaigns tile shows the event’s exact figures to the marketing role', async () => {
    const t = await tile(userCtx(marketerId, m.orgId));
    expect(t).toMatchObject({
      currency: 'USD',
      totals: {
        sends: 120,
        clicks: 6,
        uniqueClickers: 4,
        orders: 3,
        revenueMinor: 10_000,
        firstTouchOrders: 3,
        conversionBps: 5000,
      },
      more: 0,
    });
    // (the CSV test's poster link, never clicked, comes last with zeros)
    expect(t.campaigns.map((c) => [c.name, c.orders, c.revenueMinor, c.firstTouchRevenueMinor])).toEqual([
      [F.campaignName, 1, 5000, 7500],
      ['spring-social', 1, 2500, 0],
      ['spring-podcast', 1, 2500, 2500],
      ['+flyer', 0, 0, 0],
    ]);
    const d = await mail(userCtx(marketerId, m.orgId));
    expect(d).toMatchObject({
      sent: 320,
      bounceBps: 250,
      bounceOver: false,
      domainsOver: 1,
      campaignsOver: 1,
      paused: false,
      windowDays: 7,
    });
  });

  it('the door never gets revenue; viewers and scanners are refused', async () => {
    await executeCommand(
      assignEventRoleCommand,
      { eventId: s.eventId, userId: viewerId, role: 'door_staff' },
      m.ctx(),
      ports,
    );
    const door = userCtx(viewerId, m.orgId);
    await expect(tile(door)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(mail(door)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(tile(userCtx(scannerId, m.orgId))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('permissions and isolation', () => {
  it('marketing:read reads the analytics; messages:read the deliverability; scanners neither', async () => {
    const viewer = userCtx(viewerId, m.orgId);
    expect((await report({}, viewer)).totals.lastTouch.orders).toBe(F.totals.orders);
    await expect(executeQuery(deliverabilityReportQuery, {}, viewer, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const scanner = userCtx(scannerId, m.orgId);
    await expect(report({}, scanner)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(campaignDetailQuery, { key: `c.${s.campaignId}` }, scanner, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      (await executeQuery(deliverabilityReportQuery, {}, userCtx(marketerId, m.orgId), ports)).org.sent,
    ).toBe(F.orgSent);
  });

  it('another org sees none of it (queries, tiles, RLS)', async () => {
    // B's own fixture link shows; nothing of A's campaign, link, sends or orders does.
    const other = await report({ dimension: 'link' }, b.ctx());
    expect(other.rows.map((r) => r.link?.id)).not.toContain(s.campaignLinkId);
    expect(other.totals).toMatchObject({ sends: null, lastTouch: { orders: 1 } });
    expect((await report({}, b.ctx())).rows.map((r) => r.key)).not.toContain(`c.${s.campaignId}`);
    await expect(
      executeQuery(campaignDetailQuery, { key: `c.${s.campaignId}` }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await executeQuery(deliverabilityReportQuery, {}, b.ctx(), ports)).campaigns).toEqual([]);
    await expect(
      executeQuery(campaignsWidget.loader, { eventId: s.eventId }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A's owner acting in B's org is not a member there.
    await expect(report({}, userCtx(m.ownerId, b.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    const [row] = await withTenant(createCtx({ orgId: b.org.id }), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from notifications.messages where dedupe_key like ${`campaign:${s.campaignId}:%`}`,
      ),
    );
    expect(row?.n).toBe(0);
  });
});
