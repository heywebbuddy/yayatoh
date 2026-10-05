import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, DomainError, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  orderRef,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  addBusinessDays,
  applyAccountEventCommand,
  recordTransferCommand,
  releaseDueSettlementsCommand,
  settlementsQuery,
} from '@yayatoh/payments';
import {
  eventMoneyQuery,
  feesReportQuery,
  moneyOverviewQuery,
  orgFinanceQuery,
  payoutDetailQuery,
  payoutsDashboardQuery,
} from '@yayatoh/reports';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * U5 Money dashboards: read-only over the ledger. Totals match the ledger to the cent, a payout
 * drills down to exactly its orders, finance permission and tenant isolation hold.
 */

let a: OrgFixture;
let b: OrgFixture;
let ev1: string;
let ev2: string;
let order1: string;
let order2: string;
let order3: string;
let refundId: string;

const at = (iso: string) => ({ ...systemCtx(a.org.id), now: new Date(iso) });
const release = (iso: string) => executeCommand(releaseDueSettlementsCommand, {}, at(iso), ports);

async function newEvent(name: string, endsAt: string) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'UTC', startsAt: endsAt.replace('T22', 'T18'), endsAt },
    a.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 5000, quantityTotal: 50 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  return { eventId: e.id, ticketTypeId: tt.id };
}

async function buy(eventId: string, ticketTypeId: string, quantity: number, name: string) {
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId, quantity }],
      buyer: { email: `${name.toLowerCase().replace(/\s/g, '.')}@example.test`, name },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_money_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${c.order.id}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: c.order.totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId: c.order.id,
    },
    systemCtx(a.org.id),
    ports,
  );
  return c.order.id;
}

/** What the ledger booked, straight from journals and postings (the source of truth). */
async function ledger(eventIds?: string[]) {
  return withTenant(systemCtx(a.org.id), async (tx) => {
    const scope = eventIds
      ? sql`and j.event_id = any(array[${sql.join(
          eventIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}])`
      : sql``;
    const [g] = await tx.execute<{ gross: string | null; refunds: string | null }>(sql`
      select sum(case when j.kind in ('sale', 'organizer_collected_sale') then (j.memo->>'grossMinor')::bigint end)::text as gross,
        sum(case when j.kind = 'refund' then (j.memo->>'amountMinor')::bigint end)::text as refunds
      from payments.journal_entries j where true ${scope}`);
    // An organizer_mor refund that gives back no platform fee posts nothing (roadmap §5.3: the money
    // moves on the organizer's own account), so the journal cannot hold it; it is counted from the
    // refund rows, and only those (batch 3v merge: the fixture's M4.8f gift refund is one).
    const [o] = await tx.execute<{ refunds: string | null }>(sql`
      select sum(r.amount_minor)::text as refunds from orders.refunds r
      join orders.orders o on o.id = r.order_id
      where r.status = 'succeeded' and o.funds_flow = 'organizer_mor' and r.fee_refunded_minor = 0
        ${
          eventIds
            ? sql`and o.event_id = any(array[${sql.join(
                eventIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )}])`
            : sql``
        }
        and not exists (select 1 from payments.journal_entries j where j.kind = 'refund' and j.memo->>'refundId' = r.id::text)`);
    const [f] = await tx.execute<{ fees: string | null }>(sql`
      select (-sum(p.amount_minor))::text as fees from payments.postings p
      join payments.journal_entries j on j.id = p.journal_id
      where p.account in ('platform:platform_fee_deferred', 'platform:platform_fee_revenue')
        and j.kind in ('sale', 'refund', 'organizer_collected_sale') ${scope}`);
    return {
      gross: Number(g?.gross ?? 0),
      refunds: Number(g?.refunds ?? 0) + Number(o?.refunds ?? 0),
      fees: Number(f?.fees ?? 0),
    };
  });
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  const e1 = await newEvent('Money one', '2028-04-03T22:00:00Z');
  ev1 = e1.eventId;
  order1 = await buy(ev1, e1.ticketTypeId, 2, 'Ada Money');
  order2 = await buy(ev1, e1.ticketTypeId, 1, 'Bo Money');
  const e2 = await newEvent('Money two', '2028-05-01T22:00:00Z');
  ev2 = e2.eventId;
  order3 = await buy(ev2, e2.ticketTypeId, 3, 'Cy Money');
  // A refund before release: it comes out of the held funds, so it is part of the payout.
  const [ticket] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string }>(sql`select id from ticketing.tickets where order_id = ${order2}`),
  );
  const r = await executeCommand(
    startRefundCommand,
    { orderId: order2, reason: 'requested_by_customer', ticketIds: [ticket?.id ?? ''] },
    a.ctx(),
    ports,
  );
  refundId = r.refundId;
  await executeCommand(
    completeRefundCommand,
    { refundId, outcome: 'succeeded', providerRefundId: 'fakere_money' },
    a.ctx(),
    ports,
  );
});
afterAll(closePools);

describe('Money dashboards (U5)', () => {
  it('overview totals match the ledger to the cent and the registry (all time)', async () => {
    const o = await executeQuery(moneyOverviewQuery, {}, a.ctx(), ports);
    const usd = o.currencies.find((c) => c.currency === 'USD');
    expect(usd).toBeDefined();
    const fin = await executeQuery(orgFinanceQuery, {}, a.ctx(), ports);
    const metric = (key: string) => fin.metrics.find((m) => m.key === key && m.currency === 'USD')?.value;
    // Same definitions as the finance report.
    expect(usd?.totals.grossMinor).toBe(metric('sales.gross'));
    expect(usd?.totals.refundsMinor).toBe(metric('sales.refunds'));
    expect(usd?.totals.feesMinor).toBe(metric('finance.platformFees'));
    expect(usd?.totals.netMinor).toBe(metric('finance.net'));
    // And the ledger, to the cent.
    const l = await ledger();
    expect(usd?.totals.grossMinor).toBe(l.gross);
    expect(usd?.totals.refundsMinor).toBe(l.refunds);
    expect(usd?.totals.feesMinor).toBe(l.fees);
    expect(usd?.totals.netMinor).toBe(l.gross - l.refunds - l.fees - (usd?.totals.disputesLostMinor ?? 0));
    // The chart's buckets add up to the totals.
    const sum = (k: 'grossMinor' | 'refundsMinor' | 'feesMinor') =>
      usd?.buckets.reduce((acc, x) => acc + x[k], 0);
    expect(sum('grossMinor')).toBe(usd?.totals.grossMinor);
    expect(sum('refundsMinor')).toBe(usd?.totals.refundsMinor);
    expect(sum('feesMinor')).toBe(usd?.totals.feesMinor);
    expect(o.previous).toBeNull();
  });

  it('money per event matches each event in the ledger and adds up to the overview', async () => {
    const m = await executeQuery(eventMoneyQuery, {}, a.ctx(), ports);
    const one = m.events.find((e) => e.eventId === ev1);
    // 2 × (50.00 + 10 % + 0.50) + 1 × 55.50 = 166.50 gross; fee 5.50 per ticket.
    const l1 = await ledger([ev1]);
    expect(one).toMatchObject({ name: 'Money one', currency: 'USD', grossMinor: 16_650 });
    expect(one?.grossMinor).toBe(l1.gross);
    expect(one?.refundsMinor).toBe(l1.refunds);
    expect(one?.feesMinor).toBe(l1.fees);
    const o = await executeQuery(moneyOverviewQuery, {}, a.ctx(), ports);
    const usd = o.currencies.find((c) => c.currency === 'USD');
    const usdEvents = m.events.filter((e) => e.currency === 'USD');
    expect(usdEvents.reduce((acc, e) => acc + e.grossMinor, 0)).toBe(usd?.totals.grossMinor);
    expect(usdEvents.reduce((acc, e) => acc + e.netMinor, 0)).toBe(usd?.totals.netMinor);
  });

  it('a period compares with the one before, by calendar day in the org time zone', async () => {
    const o = await executeQuery(
      moneyOverviewQuery,
      { from: '2028-04-01', to: '2028-04-30' },
      a.ctx(),
      ports,
    );
    expect(o.previous).toEqual({ from: '2028-03-02', to: '2028-03-31' });
    expect(o.grain).toBe('day');
    const usd = o.currencies.find((c) => c.currency === 'USD');
    expect(usd?.buckets).toHaveLength(30);
    expect(usd?.previousTotals).not.toBeNull();
    const w = await executeQuery(
      moneyOverviewQuery,
      { from: '2028-04-01', to: '2028-04-30', grain: 'week' },
      a.ctx(),
      ports,
    );
    expect(w.currencies[0]?.buckets[0]?.start).toBe('2028-03-27');
    await expect(
      executeQuery(moneyOverviewQuery, { from: '2028-04-30', to: '2028-04-01' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('shows held funds with their release date, then the payout drills down to exactly its orders', async () => {
    let d = await executeQuery(payoutsDashboardQuery, {}, a.ctx(), ports);
    const held = d.held.find((h) => h.eventId === ev1);
    // 2 × 50.00 + 1 × 50.00 organizer share, less the refunded 50.00.
    expect(held).toMatchObject({
      eventName: 'Money one',
      heldMinor: 10_000,
      reserveMinor: 500,
      expectedMinor: 9_500,
    });
    expect(held?.releaseAt.toISOString()).toBe(
      addBusinessDays(new Date('2028-04-03T22:00:00Z'), 5).toISOString(),
    );

    await release('2028-04-11T00:00:00Z');
    d = await executeQuery(payoutsDashboardQuery, {}, a.ctx(), ports);
    expect(d.held.find((h) => h.eventId === ev1)).toBeUndefined();
    expect(d.held.find((h) => h.eventId === ev2)?.heldMinor).toBe(15_000);
    const pending = d.pending.find((p) => p.eventId === ev1);
    expect(pending).toMatchObject({ status: 'waiting_account', amountMinor: 9_500 });
    const reserve = d.reserves.find((r) => r.eventId === ev1);
    expect(reserve).toMatchObject({ reserveMinor: 500, leftMinor: 500 });
    expect(reserve?.releaseAt.toISOString()).toBe('2028-07-10T00:00:00.000Z');

    const p = await executeQuery(
      payoutDetailQuery,
      { settlementId: pending?.settlementId ?? '' },
      a.ctx(),
      ports,
    );
    expect(p).toMatchObject({
      kind: 'event',
      eventName: 'Money one',
      releasedMinor: 10_000,
      reserveMinor: 500,
      nettedMinor: 0,
      amountMinor: 9_500,
    });
    // Exactly the event's orders: two sales and the refund, nothing from the other event.
    expect(p.lines.map((x) => [x.kind, x.orderId]).sort()).toEqual(
      [
        ['refund', order2],
        ['sale', order1],
        ['sale', order2],
      ].sort(),
    );
    expect(p.lines.some((x) => x.orderId === order3)).toBe(false);
    const sale1 = p.lines.find((x) => x.orderId === order1);
    expect(sale1).toMatchObject({
      orderRef: orderRef(order1),
      buyerName: 'Ada Money',
      grossMinor: 11_100,
      feeMinor: 1_100,
      organizerMinor: 10_000,
    });
    const refund = p.lines.find((x) => x.kind === 'refund');
    // The buyer got the ticket's face value back; the platform kept its fee.
    expect(refund).toMatchObject({ grossMinor: -5_000, feeMinor: 0, organizerMinor: -5_000 });
    // The lines add up to what the payout released.
    expect(p.totals).toEqual({ grossMinor: 11_650, feeMinor: 1_650, organizerMinor: 10_000 });
    expect(p.totals.organizerMinor).toBe(p.releasedMinor);
  });

  it('a transferred payout counts in its period; fees per order and per payout', async () => {
    await executeCommand(
      applyAccountEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_acct_${uuidv7()}`,
        type: 'account.updated',
        orgId: a.org.id,
        account: {
          accountId: `fakeacct_${a.org.slug}`,
          chargesEnabled: true,
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
    const { ready } = await release('2028-04-12T00:00:00Z');
    const s = ready.find((r) => r.transferGroup === `event:${ev1}`);
    await executeCommand(
      recordTransferCommand,
      { settlementId: s?.settlementId ?? '', outcome: 'succeeded', transferId: 'faketr_money' },
      at('2028-04-12T00:03:00Z'),
      ports,
    );
    const d = await executeQuery(payoutsDashboardQuery, {}, a.ctx(), ports);
    expect(d.past.find((x) => x.settlementId === s?.settlementId)).toMatchObject({ amountMinor: 9_500 });
    const o = await executeQuery(
      moneyOverviewQuery,
      { from: '2028-04-01', to: '2028-04-30' },
      a.ctx(),
      ports,
    );
    expect(o.currencies.find((c) => c.currency === 'USD')?.totals).toMatchObject({
      payoutsMinor: 9_500,
      payouts: 1,
    });

    const f = await executeQuery(feesReportQuery, {}, a.ctx(), ports);
    const fee1 = f.perOrder.find((x) => x.orderId === order1);
    expect(fee1).toMatchObject({
      eventName: 'Money one',
      totalMinor: 11_100,
      feeMinor: 1_100,
      feeRefundedMinor: 0,
    });
    expect(f.perOrder.find((x) => x.orderId === order2)).toMatchObject({
      feeMinor: 550,
      feeRefundedMinor: 0,
    });
    expect(f.perPayout.find((x) => x.settlementId === s?.settlementId)).toMatchObject({
      feeMinor: 1_650,
      amountMinor: 9_500,
    });
    const usd = f.totals.find((t) => t.currency === 'USD');
    const l = await ledger();
    expect(usd?.feesMinor).toBe(l.fees);
  });

  it('needs finance:read: a viewer is refused every money query', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    for (const [q, input] of [
      [moneyOverviewQuery, {}],
      [eventMoneyQuery, {}],
      [payoutsDashboardQuery, {}],
      [feesReportQuery, {}],
    ] as const) {
      await expect(executeQuery(q as typeof moneyOverviewQuery, input, viewer, ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    const [s] = await executeQuery(settlementsQuery, {}, systemCtx(a.org.id), ports);
    await expect(
      executeQuery(payoutDetailQuery, { settlementId: s?.id ?? '' }, viewer, ports),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("another org never sees this org's payouts or money", async () => {
    const [s] = await executeQuery(settlementsQuery, {}, systemCtx(a.org.id), ports);
    await expect(
      executeQuery(payoutDetailQuery, { settlementId: s?.id ?? '' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const d = await executeQuery(payoutsDashboardQuery, {}, b.ctx(), ports);
    expect([...d.held, ...d.pending, ...d.past].some((x) => x.eventId === ev1 || x.eventId === ev2)).toBe(
      false,
    );
    const m = await executeQuery(eventMoneyQuery, {}, b.ctx(), ports);
    expect(m.events.some((e) => e.eventId === ev1)).toBe(false);
    const f = await executeQuery(feesReportQuery, {}, b.ctx(), ports);
    expect(f.perOrder.some((x) => x.orderId === order1)).toBe(false);
  });
});
