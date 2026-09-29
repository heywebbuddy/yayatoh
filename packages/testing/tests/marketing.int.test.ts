import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  attributeOrderCommand,
  createTrackedLinkCommand,
  createTrackedLinkTx,
  linkDetailQuery,
  linkReportQuery,
  orderAttributionQuery,
  recordClickCommand,
  resolveTrackedLink,
  setAttributionWindowCommand,
  utmOnlyReportQuery,
} from '@yayatoh/marketing';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let otherEventId: string;
let draftEventId: string;
let ga: { id: string };
const DAY = 24 * 60 * 60 * 1000;

async function publishedEvent(name: string, publish = true) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'UTC', startsAt: '2028-03-01T18:00:00Z', endsAt: '2028-03-01T23:00:00Z' },
    a.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 2000, quantityTotal: 500 },
    a.ctx(),
    ports,
  );
  if (publish)
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  return { id: e.id, ga: tt };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const main = await publishedEvent('Attribution Night');
  eventId = main.id;
  ga = main.ga;
  otherEventId = (await publishedEvent('Other Night')).id;
  draftEventId = (await publishedEvent('Draft Night', false)).id;
});
afterAll(closePools);

const link = (input: Record<string, unknown>, ctx = a.ctx()) =>
  executeCommand(
    createTrackedLinkCommand,
    { eventId, source: 'newsletter', medium: 'email', campaign: 'launch', ...input },
    ctx,
    ports,
  );
const click = (linkId: string, deviceId: string | null, daysAgo = 0, orgId = a.org.id) =>
  executeCommand(
    recordClickCommand,
    { linkId, deviceId, ip: '198.51.100.4' },
    createCtx({ orgId, now: new Date(Date.now() - daysAgo * DAY) }),
    ports,
  );
const device = () => `dev-${uuidv7().replace(/-/g, '')}`.slice(0, 40);

async function buy(n: string, onEvent = eventId, ticketTypeId = ga.id) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: onEvent,
      items: [{ ticketTypeId, quantity: 1 }],
      buyer: { email: `${n}@example.test`, name: n },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  return r.order;
}

async function pay(order: { id: string; totalMinor: number; currency: string }) {
  const pi = `fakepi_${order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${order.id}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: order.totalMinor,
      currency: order.currency,
      orgId: a.org.id,
      orderId: order.id,
    },
    systemCtx(a.org.id),
    ports,
  );
}

const attribute = (input: Record<string, unknown>, orgId = a.org.id) =>
  executeCommand(attributeOrderCommand, input, createCtx({ orgId }), ports);
const report = (ctx = a.ctx(), onEvent = eventId) =>
  executeQuery(linkReportQuery, { eventId: onEvent }, ctx, ports);

describe('tracked links', () => {
  it('creates a link with an 8-character global code; the redirector resolves it with its UTM values', async () => {
    const l = await link({ label: 'Spring newsletter', content: 'hero', term: 'gala' });
    expect(l.code).toMatch(/^[a-z2-9]{8}$/);
    expect(l).toMatchObject({
      source: 'newsletter',
      medium: 'email',
      campaign: 'launch',
      destinationPath: null,
    });
    const target = await resolveTrackedLink(l.code.toUpperCase());
    expect(target).toMatchObject({
      orgId: a.org.id,
      linkId: l.id,
      eventId,
      utm: { source: 'newsletter', medium: 'email', campaign: 'launch', content: 'hero', term: 'gala' },
    });
    expect(await resolveTrackedLink('nope1234')).toBeNull();
    expect(await resolveTrackedLink('../../x')).toBeNull();
  });

  it('links of a draft event never resolve', async () => {
    const l = await link({ eventId: draftEventId });
    expect(await resolveTrackedLink(l.code)).toBeNull();
  });

  it('refuses destinations that are not same-site paths (open-redirect guard), in the command and the database', async () => {
    for (const [destinationPath, reason] of [
      ['https://evil.example', 'destination_not_a_path'],
      ['//evil.example', 'destination_not_a_path'],
      ['/%2F%2Fevil.example', 'destination_invalid_characters'],
    ] as const)
      await expect(link({ destinationPath })).rejects.toMatchObject({
        code: 'validation_failed',
        details: { reason, field: 'destinationPath' },
      });
    expect((await link({ destinationPath: '/events/attribution-night/seat-finder' })).destinationPath).toBe(
      '/events/attribution-night/seat-finder',
    );
    // A bypass of the command still meets the CHECK constraint.
    await expect(
      withTenant(a.ctx(), (tx) =>
        tx.execute(
          sql`update marketing.tracking_links set destination_path = '//evil.example' where org_id = ${a.org.id}`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('validates UTM values and the event', async () => {
    await expect(link({ source: '' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(link({ campaign: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(link({ eventId: b.event.id })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('the hook for campaigns and journeys records their ids', async () => {
    const campaignId = uuidv7();
    const journeyStepId = uuidv7();
    const l = await withTenant(a.ctx(), (tx) =>
      createTrackedLinkTx(tx, a.ctx(), {
        eventId,
        source: 'journey',
        medium: 'email',
        campaign: 'reminders',
        campaignId,
        journeyStepId,
      }),
    );
    expect(l).toMatchObject({ campaignId, journeyStepId });
  });

  it('the click log stores only keyed hashes (no raw IP or device id)', async () => {
    const l = await link({});
    const d = device();
    const { clickId } = await click(l.id, d);
    const [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<Record<string, unknown>>(sql`select * from marketing.link_clicks where id = ${clickId}`),
    );
    expect(row?.device_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(row?.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain(d);
    expect(JSON.stringify(row)).not.toContain('198.51.100.4');
  });
});

describe('attribution', () => {
  it('click → purchase: first touch is the earliest click, last touch the latest; paid orders count in the report', async () => {
    const email = await link({ source: 'newsletter', campaign: 'first-last' });
    const social = await link({ source: 'instagram', medium: 'social', campaign: 'first-last' });
    const d = device();
    await click(email.id, d, 5);
    const last = await click(social.id, d, 1);
    const order = await buy('first-last');
    expect(await attribute({ orderId: order.id, clickIds: [last.clickId], deviceId: d })).toEqual({
      outcome: 'click',
    });
    const rec = await executeQuery(orderAttributionQuery, { orderId: order.id }, a.ctx(), ports);
    expect(rec).toMatchObject({
      model: 'click',
      windowDays: 30,
      firstTouch: { linkId: email.id, code: email.code, source: 'newsletter' },
      lastTouch: { linkId: social.id, code: social.code, source: 'instagram', medium: 'social' },
    });
    expect(Object.keys(rec ?? {}).sort()).toEqual([
      'firstTouch',
      'lastTouch',
      'model',
      'orderId',
      'windowDays',
    ]);
    expect(JSON.stringify(rec)).not.toMatch(/hash|first-last@/);

    // Reserved (not paid yet): no order, no revenue.
    let row = (await report()).find((r) => r.link.id === social.id);
    expect(row?.stats).toMatchObject({ clicks: 1, visitors: 1, orders: 0, firstTouchOrders: 0, revenue: [] });

    await pay(order);
    const rows = await report();
    row = rows.find((r) => r.link.id === social.id);
    expect(row?.stats).toMatchObject({
      clicks: 1,
      orders: 1,
      firstTouchOrders: 0,
      revenue: [{ currency: order.currency, amountMinor: order.totalMinor }],
      conversionBps: 10_000,
    });
    expect(rows.find((r) => r.link.id === email.id)?.stats).toMatchObject({
      orders: 0,
      firstTouchOrders: 1,
      revenue: [],
    });
    const detail = await executeQuery(linkDetailQuery, { linkId: email.id }, a.ctx(), ports);
    expect(detail.orders).toEqual([
      expect.objectContaining({ orderId: order.id, touch: 'first', status: 'paid', sold: true }),
    ]);
    expect(JSON.stringify(detail)).not.toMatch(/buyer|email@|first-last@/);
    // Idempotent: the record is written once.
    expect(await attribute({ orderId: order.id, deviceId: d })).toEqual({ outcome: 'exists' });
  });

  it('a single click is both touches; a second click on the same link counts in clicks and visitors', async () => {
    const l = await link({ campaign: 'both' });
    const d = device();
    const c = await click(l.id, d, 0.01);
    await click(l.id, device(), 0.01);
    const order = await buy('both');
    await attribute({ orderId: order.id, clickIds: [c.clickId] });
    await pay(order);
    const detail = await executeQuery(linkDetailQuery, { linkId: l.id }, a.ctx(), ports);
    expect(detail.stats).toMatchObject({
      clicks: 2,
      visitors: 2,
      orders: 1,
      firstTouchOrders: 1,
      conversionBps: 5000,
    });
    expect(detail.orders[0]).toMatchObject({ touch: 'both' });
  });

  it('an expired click (outside the window) is ignored; a shorter window drops older clicks', async () => {
    const l = await link({ campaign: 'expired' });
    const d = device();
    const old = await click(l.id, d, 31);
    const o1 = await buy('expired');
    expect(await attribute({ orderId: o1.id, clickIds: [old.clickId], deviceId: d })).toEqual({
      outcome: 'none',
    });
    expect(await executeQuery(orderAttributionQuery, { orderId: o1.id }, a.ctx(), ports)).toBeNull();

    const d2 = device();
    const tenDays = await click(l.id, d2, 10);
    await executeCommand(setAttributionWindowCommand, { windowDays: 7 }, a.ctx(), ports);
    try {
      const o2 = await buy('seven-days');
      expect(await attribute({ orderId: o2.id, clickIds: [tenDays.clickId], deviceId: d2 })).toEqual({
        outcome: 'none',
      });
    } finally {
      await executeCommand(setAttributionWindowCommand, { windowDays: 30 }, a.ctx(), ports);
    }
  });

  it('a click on another event does not attribute this event’s order', async () => {
    const other = await link({ eventId: otherEventId, campaign: 'other' });
    const d = device();
    const c = await click(other.id, d, 1);
    const order = await buy('other-event');
    expect(await attribute({ orderId: order.id, clickIds: [c.clickId], deviceId: d })).toEqual({
      outcome: 'none',
    });
  });

  it('UTM-only attribution when there is no click; UTM landings outside the window are ignored', async () => {
    const now = Date.now();
    const order = await buy('utm-only');
    expect(
      await attribute({
        orderId: order.id,
        deviceId: device(),
        utm: {
          first: { source: 'facebook', medium: 'social', campaign: 'spring', at: now - 3 * DAY },
          last: { source: 'partner-site', medium: 'referral', campaign: 'spring', at: now - DAY },
        },
      }),
    ).toEqual({ outcome: 'utm' });
    const rec = await executeQuery(orderAttributionQuery, { orderId: order.id }, a.ctx(), ports);
    expect(rec).toMatchObject({
      model: 'utm',
      firstTouch: { linkId: null, code: null, source: 'facebook' },
      lastTouch: { linkId: null, source: 'partner-site', medium: 'referral' },
    });
    await pay(order);
    const utm = await executeQuery(utmOnlyReportQuery, { eventId }, a.ctx(), ports);
    expect(utm).toContainEqual({
      source: 'partner-site',
      medium: 'referral',
      campaign: 'spring',
      orders: 1,
      revenue: [{ currency: order.currency, amountMinor: order.totalMinor }],
    });

    const stale = await buy('utm-stale');
    expect(
      await attribute({
        orderId: stale.id,
        utm: {
          first: { source: 'old', at: now - 40 * DAY },
          last: { source: 'old', at: now - 31 * DAY },
        },
      }),
    ).toEqual({ outcome: 'none' });
  });
});

describe('isolation', () => {
  it('another org cannot read, click or attribute with this org’s links', async () => {
    const l = await link({ campaign: 'isolated' });
    // The redirector names the link's org; recording a click under another org finds nothing.
    await expect(click(l.id, device(), 0, b.org.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await report(b.ctx())).toEqual([]);
    await expect(executeQuery(linkDetailQuery, { linkId: l.id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // Org A's click id offered for org B's order is invisible there.
    const c = await click(l.id, device());
    const bLink = await executeQuery(linkReportQuery, { eventId: b.event.id }, b.ctx(), ports);
    expect(bLink.every((r) => r.link.id !== l.id)).toBe(true);
    const [bOrder] = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ id: string }>(sql`select id from orders.orders order by created_at desc limit 1`),
    );
    expect(await attribute({ orderId: bOrder?.id, clickIds: [c.clickId] }, b.org.id)).toMatchObject({
      outcome: expect.stringMatching(/^(none|exists)$/),
    });
    await expect(attribute({ orderId: bOrder?.id }, a.org.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('permissions', () => {
  it('a viewer reads the reports but cannot create links or change the window; a scanner reads nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(Array.isArray(await report(viewer))).toBe(true);
    await expect(link({}, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(setAttributionWindowCommand, { windowDays: 10 }, viewer, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    const scannerId = uuidv7();
    await executeCommand(addMemberCommand, { userId: scannerId, role: 'scanner' }, a.ctx(), ports);
    await expect(report(userCtx(scannerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    const marketerId = uuidv7();
    await executeCommand(addMemberCommand, { userId: marketerId, role: 'marketing' }, a.ctx(), ports);
    expect((await link({ campaign: 'by-marketer' }, userCtx(marketerId, a.org.id))).campaign).toBe(
      'by-marketer',
    );
  });

  it('the window stays within 1–90 days', async () => {
    for (const windowDays of [0, 91, 1.5])
      await expect(
        executeCommand(setAttributionWindowCommand, { windowDays }, a.ctx(), ports),
      ).rejects.toMatchObject({
        code: 'validation_failed',
      });
  });
});
