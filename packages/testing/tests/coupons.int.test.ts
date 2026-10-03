import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { expireOrdersCommand, startCheckoutCommand } from '@yayatoh/orders';
import {
  createCouponCommand,
  createPromoCodeCommand,
  createTicketTypeCommand,
  listCouponsQuery,
  listOrgPromoCodesQuery,
  setCouponActiveCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/** U9 (UX-5): org-wide coupons at checkout. */
let a: OrgFixture;
let b: OrgFixture;
const ev: Record<'one' | 'two' | 'euro', { id: string; ga: string }> = {
  one: { id: '', ga: '' },
  two: { id: '', ga: '' },
  euro: { id: '', ga: '' },
};
let bEvent: { id: string; ga: string };

async function sellingEvent(org: OrgFixture, name: string, currency = 'USD') {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      timezone: 'UTC',
      startsAt: '2027-12-01T18:00:00Z',
      endsAt: '2027-12-01T23:00:00Z',
      currency,
    },
    org.ctx(),
    ports,
  );
  const ga = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 4000, quantityTotal: 500, maxPerOrder: 10 },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, org.ctx(), ports);
  return { id: e.id, ga: ga.id };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev.one = await sellingEvent(a, 'Coupon one');
  ev.two = await sellingEvent(a, 'Coupon two');
  ev.euro = await sellingEvent(a, 'Coupon euro', 'EUR');
  bEvent = await sellingEvent(b, 'Coupon B');
});
afterAll(closePools);

const coupon = (input: Record<string, unknown>, org = a) =>
  executeCommand(createCouponCommand, input, org.ctx(), ports);
const buy = (
  event: { id: string; ga: string },
  code: string | undefined,
  who = 'buyer',
  org = a,
  quantity = 1,
) =>
  executeCommand(
    startCheckoutCommand,
    {
      eventId: event.id,
      items: [{ ticketTypeId: event.ga, quantity }],
      buyer: { email: `${who}@example.test`, name: who },
      promoCode: code,
    },
    createCtx({ orgId: org.org.id }),
    ports,
  );
const used = async (code: string) =>
  (await executeQuery(listCouponsQuery, {}, a.ctx(), ports)).find((c) => c.code === code)?.redeemedCount;
const invalid = { code: 'validation_failed', details: { reason: 'promo_invalid' } };

describe('org-wide coupons', () => {
  it('an all-events coupon applies at every event; the order keeps the code and the coupon', async () => {
    await coupon({ code: 'org10', kind: 'percent', percentBps: 1000 });
    const one = await buy(ev.one, ' Org10 ', 'all1');
    const two = await buy(ev.two, 'ORG10', 'all2');
    for (const r of [one, two]) {
      expect(r.order).toMatchObject({ discountMinor: 400, promoCode: 'ORG10' });
    }
    const [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ coupon_id: string | null; promo_code_id: string | null }>(
        sql`select coupon_id, promo_code_id from orders.orders where id = ${one.order.id}`,
      ),
    );
    expect(row?.coupon_id).toBeTruthy();
    expect(row?.promo_code_id).toBeNull();
    expect(await used('ORG10')).toBe(2);
  });

  it('a chosen-events coupon applies only to its events', async () => {
    await coupon({
      code: 'ONLYONE',
      kind: 'percent',
      percentBps: 2500,
      scope: 'events',
      eventIds: [ev.one.id],
    });
    await expect(buy(ev.one, 'ONLYONE', 'chosen1')).resolves.toMatchObject({
      order: { discountMinor: 1000 },
    });
    await expect(buy(ev.two, 'ONLYONE', 'chosen2')).rejects.toMatchObject(invalid);
  });

  it('an amount coupon applies only to events in its currency; a percentage applies in any', async () => {
    await coupon({ code: 'FIVEUSD', kind: 'amount', amountMinor: 500, currency: 'USD' });
    await expect(buy(ev.one, 'FIVEUSD', 'usd')).resolves.toMatchObject({ order: { discountMinor: 500 } });
    await expect(buy(ev.euro, 'FIVEUSD', 'eur')).rejects.toMatchObject(invalid);
    const euro = await buy(ev.euro, 'ORG10', 'eur10');
    expect(euro.order).toMatchObject({ currency: 'EUR', discountMinor: 400 });
    // Chosen events in another currency are refused when the coupon is made.
    await expect(
      coupon({
        code: 'BADMIX',
        kind: 'amount',
        amountMinor: 500,
        currency: 'USD',
        scope: 'events',
        eventIds: [ev.euro.id],
      }),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'currency_mismatch' } });
  });

  it('unknown, inactive, not-yet-started and ended coupons are all just "not valid"', async () => {
    const paused = await coupon({ code: 'OFFNOW', kind: 'percent', percentBps: 1000 });
    await executeCommand(setCouponActiveCommand, { couponId: paused.id, active: false }, a.ctx(), ports);
    await coupon({ code: 'SOON', kind: 'percent', percentBps: 1000, startsAt: '2099-01-01T00:00:00Z' });
    await coupon({
      code: 'OVER',
      kind: 'percent',
      percentBps: 1000,
      startsAt: '2020-01-01T00:00:00Z',
      endsAt: '2020-02-01T00:00:00Z',
    });
    for (const code of ['NOSUCH', 'OFFNOW', 'SOON', 'OVER'])
      await expect(buy(ev.one, code, 'window')).rejects.toMatchObject(invalid);
  });

  it('30 concurrent checkouts never take a 3-use coupon more than 3 times (the last use)', async () => {
    await coupon({ code: 'LAST3', kind: 'percent', percentBps: 5000, maxRedemptions: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) => buy(i % 2 ? ev.one : ev.two, 'LAST3', `race${i}`)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject(invalid);
    expect(await used('LAST3')).toBe(3);
  });

  it('one buyer racing for their last use gets it once; other buyers are not affected', async () => {
    await coupon({ code: 'ONEEACH', kind: 'percent', percentBps: 1000, perBuyerLimit: 1 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => buy(i % 2 ? ev.one : ev.two, 'ONEEACH', 'same-buyer')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results)
      if (r.status === 'rejected')
        expect(r.reason).toMatchObject({ details: { reason: 'coupon_buyer_limit', field: 'promoCode' } });
    // The address is matched as one contact whatever its case.
    await expect(buy(ev.one, 'ONEEACH', 'SAME-BUYER')).rejects.toMatchObject({
      details: { reason: 'coupon_buyer_limit' },
    });
    await expect(buy(ev.one, 'ONEEACH', 'another-buyer')).resolves.toBeTruthy();
    expect(await used('ONEEACH')).toBe(2);
  });

  it('an expired hold gives back both the use and the buyer’s share', async () => {
    await coupon({
      code: 'ONCE',
      kind: 'amount',
      amountMinor: 500,
      currency: 'USD',
      maxRedemptions: 1,
      perBuyerLimit: 1,
    });
    await buy(ev.one, 'ONCE', 'lapser');
    expect(await used('ONCE')).toBe(1);
    await withTenant(a.ctx(), (tx) =>
      tx.execute(
        sql`update orders.orders set expires_at = now() - interval '1 minute' where promo_code = 'ONCE'`,
      ),
    );
    await executeCommand(expireOrdersCommand, {}, systemCtx(a.org.id), ports);
    expect(await used('ONCE')).toBe(0);
    await expect(buy(ev.two, 'ONCE', 'lapser')).resolves.toBeTruthy();
    expect(await used('ONCE')).toBe(1);
  });

  it('a code is one thing per org: coupons and event promo codes never share it', async () => {
    await executeCommand(
      createPromoCodeCommand,
      { eventId: ev.two.id, code: 'EVENTONLY', kind: 'percent', percentBps: 1000 },
      a.ctx(),
      ports,
    );
    await expect(coupon({ code: 'eventonly', kind: 'percent', percentBps: 500 })).rejects.toMatchObject({
      code: 'conflict',
      details: { field: 'code' },
    });
    await expect(
      executeCommand(
        createPromoCodeCommand,
        { eventId: ev.one.id, code: 'ORG10', kind: 'percent', percentBps: 1000 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(coupon({ code: 'ORG10', kind: 'percent', percentBps: 500 })).rejects.toMatchObject({
      code: 'conflict',
    });
    // The org list carries both kinds with their counts.
    const promos = await executeQuery(listOrgPromoCodesQuery, {}, a.ctx(), ports);
    expect(promos.some((p) => p.code === 'EVENTONLY' && p.eventId === ev.two.id)).toBe(true);
  });

  it('validates values; viewers cannot create; another org neither sees nor redeems the coupons', async () => {
    await expect(coupon({ code: 'NOAMT', kind: 'amount', amountMinor: 500 })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      coupon({ code: 'NOEVENTS', kind: 'percent', percentBps: 500, scope: 'events' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      coupon({
        code: 'BACKWARDS',
        kind: 'percent',
        percentBps: 500,
        startsAt: '2030-01-02',
        endsAt: '2030-01-01',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      coupon({ code: 'OTHERORG', kind: 'percent', percentBps: 500, scope: 'events', eventIds: [bEvent.id] }),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'eventIds' } });
    await expect(
      executeCommand(
        createCouponCommand,
        { code: 'VIEWER', kind: 'percent', percentBps: 100 },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const bList = await executeQuery(listCouponsQuery, {}, b.ctx(), ports);
    expect(bList.some((c) => c.code === 'ORG10')).toBe(false);
    await expect(buy(bEvent, 'ORG10', 'cross', b)).rejects.toMatchObject(invalid);
    // The same code is free to use in another org.
    await expect(coupon({ code: 'ORG10', kind: 'percent', percentBps: 500 }, b)).resolves.toMatchObject({
      code: 'ORG10',
    });
  });
});
