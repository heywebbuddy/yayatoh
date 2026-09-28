import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  refundOrder,
  startCheckoutCommand,
} from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  fakePaymentProvider,
  memoryBalanceStore,
  RELEASE_POLICY,
  receivablesQuery,
  reconcileOrgDay,
  releaseDate,
  settlementsQuery,
  settleOrg,
  signFakeWebhook,
} from '@yayatoh/payments';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Refund-after-transfer scenarios (roadmap M1.6 acceptance), run against the fake provider with a
 * controllable clock — what Stripe test clocks do against the real API (`stripe:test-clocks`,
 * manual). platform_mor: a refund after the organizer was paid takes the organizer's share back
 * by an explicit transfer reversal; when the reversal fails it stays a receivable, netted from
 * the next release. Every day of it reconciles with the provider's balance.
 */
const SECRET = 'refund-after-transfer-secret-0123456789abcdef';
let a: OrgFixture;
let clock = new Date('2027-01-01T12:00:00Z');
const store = memoryBalanceStore();
const fake = fakePaymentProvider({ secret: SECRET, appOrigin: 'http://localhost', store, now: () => clock });
const day = (d: Date) => d.toISOString().slice(0, 10);
const hours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

async function eventWithTickets(name: string, end: string, priceMinor: number) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'UTC', startsAt: `${end}T18:00:00Z`, endsAt: `${end}T22:00:00Z` },
    a.ctx(),
    ports,
  );
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor, quantityTotal: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  return { eventId: e.id, typeId: t.id, endsAt: e.endsAt };
}

/** Buy through checkout; the provider's signed webhook marks it paid (and records the charge). */
async function buy(eventId: string, typeId: string, quantity: number) {
  const at = clock;
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: typeId, quantity }],
      buyer: { email: 'tc@example.test', name: 'Tess Clock' },
    },
    createCtx({ orgId: a.org.id, now: at }),
    ports,
  );
  const pi = `fakepi_tc_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: a.org.id, now: at }),
    ports,
  );
  const s = signFakeWebhook(SECRET, {
    type: 'payment.succeeded',
    providerPaymentId: pi,
    amountMinor: c.order.totalMinor,
    currency: 'USD',
    orgId: a.org.id,
    orderId: c.order.id,
  });
  const evt = await fake.verifyWebhook(s.body, new Headers({ 'x-fake-signature': s.signature }));
  await executeCommand(applyProviderEventCommand, evt, { ...systemCtx(a.org.id), now: at }, ports);
  const tickets = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from ticketing.tickets where order_id = ${c.order.id} order by serial`,
    ),
  );
  return { orderId: c.order.id, ticketIds: tickets.map((t) => t.id) };
}

const refundTicket = (orderId: string, ticketId: string) =>
  refundOrder({ orderId, reason: 'duplicate', ticketIds: [ticketId] }, a.ctx({ now: clock }), ports, fake);
const receivables = () => executeQuery(receivablesQuery, {}, a.ctx(), ports);
const owed = async () =>
  (await receivables()).outstanding.find((o) => o.currency === 'USD')?.amountMinor ?? 0;

beforeAll(async () => {
  ({ a } = await twoOrgs());
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_tc_${a.org.slug}`,
      type: 'account.updated',
      orgId: a.org.id,
      account: {
        accountId: `fakeacct_${a.org.slug}`,
        chargesEnabled: false,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsDue: [],
        country: 'US',
        defaultCurrency: 'usd',
      },
    },
    systemCtx(a.org.id),
    ports,
  );
});
afterAll(closePools);

describe('refund after transfer (fake provider, controllable clock)', () => {
  let small: { eventId: string; typeId: string; endsAt: Date };
  let big: { eventId: string; typeId: string; endsAt: Date };
  let smallOrder: { orderId: string; ticketIds: string[] };
  let bigOrder: { orderId: string; ticketIds: string[] };

  it('before release: the organizer’s share comes from held funds; nothing to reverse', async () => {
    small = await eventWithTickets('Clock Small', '2027-01-10', 4_000);
    big = await eventWithTickets('Clock Big', '2027-01-10', 150_000);
    smallOrder = await buy(small.eventId, small.typeId, 3);
    bigOrder = await buy(big.eventId, big.typeId, 2);
    clock = hours(clock, 24);
    const r = await refundTicket(smallOrder.orderId, smallOrder.ticketIds[0] ?? '');
    expect(r.status).toBe('succeeded');
    expect(await owed()).toBe(0);
    expect(
      (await store.list(new Date(0), new Date('2100-01-01'))).some((t) => t.kind === 'transfer_reversal'),
    ).toBe(false);
  });

  it('the release pays the organizer at event end + 5 business days, less the 5% reserve', async () => {
    clock = hours(releaseDate(small.endsAt), 1);
    const r = await settleOrg(fake, a.org.id, ports, { now: clock });
    expect(r.transferred).toBeGreaterThanOrEqual(2);
    const s = await executeQuery(settlementsQuery, {}, a.ctx(), ports);
    const bigSettlement = s.find((x) => x.eventId === big.eventId && x.kind === 'event');
    expect(bigSettlement).toMatchObject({ status: 'transferred' });
    expect(bigSettlement?.reserveMinor).toBe(
      Math.floor(((bigSettlement?.releasedMinor ?? 0) * RELEASE_POLICY.reserveBps) / 10_000),
    );
  });

  it('after transfer, a small refund is reversed from the organizer’s account: no receivable left', async () => {
    clock = hours(clock, 24);
    const before = await receivables();
    const r = await refundTicket(smallOrder.orderId, smallOrder.ticketIds[1] ?? '');
    expect(r.status).toBe('succeeded');
    expect(await owed()).toBe(0);
    const after = await receivables();
    const fresh = after.entries.filter((e) => !before.entries.some((b) => b.journalId === e.journalId));
    // The refund first drew on the event's reserve; the rest was owed, then reversed.
    expect(fresh.map((e) => e.source).sort()).toEqual(['refund', 'transfer_reversal']);
    expect(fresh.reduce((n, e) => n + e.amountMinor, 0)).toBe(0);
    expect(
      store.list(new Date(0), new Date('2100-01-01')).filter((t) => t.kind === 'transfer_reversal'),
    ).toHaveLength(1);
  });

  it('when the reversal fails the debt stays a receivable, shown on the settlement view, netted at the next release', async () => {
    clock = hours(clock, 24);
    await refundTicket(bigOrder.orderId, bigOrder.ticketIds[0] ?? '');
    const debt = await owed();
    // 150 000 less what the event's reserve covered: over the fake's reversal limit, so it failed.
    expect(debt).toBeGreaterThan(100_000);
    expect((await receivables()).entries[0]).toMatchObject({
      source: 'refund',
      amountMinor: debt,
      eventId: big.eventId,
    });

    // A later event's release pays the debt first.
    const later = await eventWithTickets('Clock Later', '2027-02-10', 150_000);
    await buy(later.eventId, later.typeId, 2);
    clock = hours(releaseDate(later.endsAt), 1);
    await settleOrg(fake, a.org.id, ports, { now: clock });
    const s = (await executeQuery(settlementsQuery, {}, a.ctx(), ports)).find(
      (x) => x.eventId === later.eventId && x.kind === 'event',
    );
    expect(s?.nettedMinor).toBe(debt);
    expect(s?.amountMinor).toBe((s?.releasedMinor ?? 0) - (s?.reserveMinor ?? 0) - debt);
    expect(await owed()).toBe(0);
    expect((await receivables()).entries[0]).toMatchObject({
      source: 'receivable_netting',
      amountMinor: -debt,
    });
  });

  it('every day of it reconciles with what the provider moved', async () => {
    const days = new Set(store.list(new Date(0), new Date('2100-01-01')).map((t) => day(t.occurredAt)));
    expect(days.size).toBeGreaterThanOrEqual(4);
    for (const d of days) {
      const run = await reconcileOrgDay(fake, a.org.id, d, ports);
      expect({ d, items: run?.itemCount }).toEqual({ d, items: 0 });
    }
  });
});
