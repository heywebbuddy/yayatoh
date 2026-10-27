import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  recordBoxOfficeSaleCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  eventMoneyQuery,
  feesReportQuery,
  moneyOverviewQuery,
  orgFinanceQuery,
  orgReportQuery,
} from '@yayatoh/reports';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * "One organization only shows the revenue that belongs to it": two orgs that both have orders
 * (different prices, fees, a refund in one, a box-office sale in the other) each see exactly their
 * own gross, refunds, fees and net, never a cross-org or marketplace-wide total.
 * Net = gross - refunds - disputes - platform fees.
 */
let a: OrgFixture;
let b: OrgFixture;
const RUN = uuidv7().slice(-8);
const ev: Record<'a' | 'b', string> = { a: '', b: '' };
const type: Record<'a' | 'b', string> = { a: '', b: '' };
const fx = (k: 'a' | 'b') => (k === 'a' ? a : b);

async function setup(k: 'a' | 'b', priceMinor: number, percentBps: number) {
  const f = fx(k);
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps, fixedMinor: 0, reason: 'isolation test' },
    systemCtx(f.org.id),
    ports,
  );
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Revenue ${k} ${RUN}`,
      timezone: 'UTC',
      startsAt: '2028-06-01T18:00:00Z',
      endsAt: '2028-06-01T22:00:00Z',
    },
    f.ctx(),
    ports,
  );
  ev[k] = e.id;
  type[k] = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'GA', priceMinor, quantityTotal: 100 },
      f.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, f.ctx(), ports);
}

async function buy(k: 'a' | 'b', quantity: number, who: string) {
  const f = fx(k);
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId: ev[k],
      items: [{ ticketTypeId: type[k], quantity }],
      buyer: { email: `${who}.${RUN}@example.test`, name: who },
    },
    createCtx({ orgId: f.org.id }),
    ports,
  );
  const pi = `fakepi_rev_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: f.org.id }),
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
      orgId: f.org.id,
      orderId: c.order.id,
    },
    systemCtx(f.org.id),
    ports,
  );
  return c.order;
}

/** What the org's own paid orders add up to, straight from its order rows. */
async function ownOrders(k: 'a' | 'b') {
  return withTenant(systemCtx(fx(k).org.id), async (tx) => {
    const [r] = await tx.execute<{ gross: string | null; fee: string | null }>(
      sql`select sum(total_minor)::text as gross, sum(fee_minor)::text as fee from orders.orders where status in ('paid','partially_refunded','refunded')`,
    );
    const [f] = await tx.execute<{ refunds: string | null }>(
      sql`select sum(amount_minor)::text as refunds from orders.refunds where status = 'succeeded'`,
    );
    return { gross: Number(r?.gross ?? 0), fee: Number(r?.fee ?? 0), refunds: Number(f?.refunds ?? 0) };
  });
}

let aRefund = 0;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await setup('a', 5000, 1000); // org A: 10 % fee
  await setup('b', 8000, 500); // org B: 5 % fee and another price
  await buy('a', 2, 'ann');
  const second = await buy('a', 1, 'abe');
  await buy('b', 3, 'bea');
  // A box-office sale in org B: the organizer took the money, the platform fee is still recorded.
  await executeCommand(
    recordBoxOfficeSaleCommand,
    {
      eventId: ev.b,
      items: [{ ticketTypeId: type.b, quantity: 1 }],
      buyer: { email: `door.${RUN}@example.test`, name: 'Door' },
      method: 'cash',
    },
    b.ctx(),
    ports,
  );
  // A refund in org A only.
  const [t] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string }>(sql`select id from ticketing.tickets where order_id = ${second.id}`),
  );
  const r = await executeCommand(
    startRefundCommand,
    { orderId: second.id, reason: 'requested_by_customer', ticketIds: [t?.id ?? ''] },
    a.ctx(),
    ports,
  );
  await executeCommand(
    completeRefundCommand,
    { refundId: r.refundId, outcome: 'succeeded', providerRefundId: 'fakere_rev' },
    a.ctx(),
    ports,
  );
  aRefund = second.totalMinor;
});
afterAll(closePools);

const usd = async (k: 'a' | 'b') =>
  (await executeQuery(moneyOverviewQuery, {}, fx(k).ctx(), ports)).currencies.find(
    (c) => c.currency === 'USD',
  );

describe('each organization sees only its own revenue', () => {
  it('gross and refunds on the money overview are the orgs own, never summed across orgs', async () => {
    const ua = await usd('a');
    const ub = await usd('b');
    const oa = await ownOrders('a');
    const ob = await ownOrders('b');
    expect(ua?.totals.grossMinor).toBe(oa.gross);
    expect(ub?.totals.grossMinor).toBe(ob.gross);
    expect(ua?.totals.grossMinor).not.toBe(oa.gross + ob.gross);
    expect(ua?.totals.refundsMinor).toBe(oa.refunds);
    expect(oa.refunds).toBeGreaterThanOrEqual(aRefund);
    expect(ub?.totals.refundsMinor).toBe(ob.refunds);
  });

  it('net is gross minus refunds, disputes and the platform fees of that orgs orders (B11)', async () => {
    for (const k of ['a', 'b'] as const) {
      const t = (await usd(k))?.totals;
      expect(t?.feesMinor ?? 0).toBeGreaterThan(0);
      expect(t?.netMinor).toBe(
        (t?.grossMinor ?? 0) - (t?.refundsMinor ?? 0) - (t?.disputesLostMinor ?? 0) - (t?.feesMinor ?? 0),
      );
      expect(t?.netMinor).toBeLessThan(t?.grossMinor ?? 0);
    }
  });

  it('fees include the box-office sale: the platform fee is recorded when the organizer took the money', async () => {
    const ub = await usd('b');
    const ob = await ownOrders('b');
    expect(ub?.totals.feesMinor).toBe(ob.fee);
  });

  it('finance report, org report, per-event money and fees report agree per org and leak nothing', async () => {
    for (const [k, other] of [
      ['a', 'b'],
      ['b', 'a'],
    ] as const) {
      const f = fx(k);
      const u = await usd(k);
      const fin = await executeQuery(orgFinanceQuery, {}, f.ctx(), ports);
      const metric = (key: string) => fin.metrics.find((m) => m.key === key && m.currency === 'USD')?.value;
      expect(metric('sales.gross')).toBe(u?.totals.grossMinor);
      expect(metric('finance.net')).toBe(u?.totals.netMinor);
      const m = await executeQuery(eventMoneyQuery, {}, f.ctx(), ports);
      const ids = m.events.map((e) => e.eventId);
      expect(ids).toContain(ev[k]);
      expect(ids).not.toContain(ev[other]);
      const rep = await executeQuery(orgReportQuery, {}, f.ctx(), ports);
      expect(JSON.stringify(rep)).not.toContain(ev[other]);
      const fees = await executeQuery(feesReportQuery, {}, f.ctx(), ports);
      expect(JSON.stringify(fees)).not.toContain(ev[other]);
    }
  });
});
