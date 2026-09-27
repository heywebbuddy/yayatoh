import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { expireOrdersCommand, startCheckoutCommand } from '@yayatoh/orders';
import {
  createPromoCodeCommand,
  createTicketTypeCommand,
  listPromoCodesQuery,
  setPromoCodeActiveCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let ga: { id: string };
let vip: { id: string };

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  // 5% + 50¢ per ticket, passed on, so fee-on-discounted-face is visible in the totals.
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 500, fixedMinor: 50, reason: 'test' },
    systemCtx(a.org.id),
    ports,
  );
  const e = await executeCommand(
    createEventCommand,
    { name: 'Promo', timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-01T23:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  ga = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'GA', priceMinor: 4000, quantityTotal: 500, maxPerOrder: 10 },
    a.ctx(),
    ports,
  );
  vip = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'VIP', priceMinor: 10000, quantityTotal: 50, maxPerOrder: 4 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

const promo = (input: Record<string, unknown>) =>
  executeCommand(createPromoCodeCommand, { eventId, ...input }, a.ctx(), ports);
const buy = (items: { ticketTypeId: string; quantity: number }[], promoCode?: string, n = 'buyer') =>
  executeCommand(
    startCheckoutCommand,
    { eventId, items, buyer: { email: `${n}@example.test`, name: n }, promoCode },
    createCtx({ orgId: a.org.id }),
    ports,
  );
const used = async (code: string) =>
  (await executeQuery(listPromoCodesQuery, { eventId }, a.ctx(), ports)).find((p) => p.code === code)
    ?.redeemedCount;

describe('promo codes', () => {
  it('a percentage comes off the face price before fees; codes match case-insensitively', async () => {
    await promo({ code: 'early20', kind: 'percent', percentBps: 2000 });
    const r = await buy([{ ticketTypeId: ga.id, quantity: 2 }], ' Early20 ');
    // Face 4000 − 20% = 3200; fee 5% of 3200 + 50 = 210; all-in 3410 × 2.
    expect(r.order).toMatchObject({
      subtotalMinor: 6400,
      discountMinor: 1600,
      feeMinor: 420,
      totalMinor: 6820,
      promoCode: 'EARLY20',
    });
    expect(r.order.items[0]?.unitAllInMinor).toBe(3410);
    expect(await used('EARLY20')).toBe(1);
  });

  it('a fixed amount is capped at the face price and can be limited to some passes', async () => {
    await promo({ code: 'VIPONLY', kind: 'amount', amountMinor: 15000, ticketTypeIds: [vip.id] });
    const r = await buy(
      [
        { ticketTypeId: vip.id, quantity: 1 },
        { ticketTypeId: ga.id, quantity: 1 },
      ],
      'viponly',
    );
    const byType = new Map(r.order.items.map((i) => [i.ticketTypeId, i.unitAllInMinor]));
    expect(byType.get(vip.id)).toBe(0); // 10000 face fully discounted: no fee on a free ticket
    expect(byType.get(ga.id)).toBe(4250);
    expect(r.order.discountMinor).toBe(10000);
    // The code takes nothing off a GA-only cart, so it is refused rather than silently ignored.
    await expect(buy([{ ticketTypeId: ga.id, quantity: 1 }], 'VIPONLY')).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'promo_invalid' },
    });
  });

  it('unknown, inactive, not-yet-started and ended codes are all just "not valid"', async () => {
    const p = await promo({ code: 'PAUSED', kind: 'percent', percentBps: 1000 });
    await executeCommand(setPromoCodeActiveCommand, { promoCodeId: p.id, active: false }, a.ctx(), ports);
    await promo({ code: 'LATER', kind: 'percent', percentBps: 1000, startsAt: '2099-01-01T00:00:00Z' });
    await promo({
      code: 'GONE',
      kind: 'percent',
      percentBps: 1000,
      startsAt: '2020-01-01T00:00:00Z',
      endsAt: '2020-02-01T00:00:00Z',
    });
    for (const code of ['NOPE', 'PAUSED', 'LATER', 'GONE']) {
      await expect(buy([{ ticketTypeId: ga.id, quantity: 1 }], code)).rejects.toMatchObject({
        details: { reason: 'promo_invalid' },
      });
    }
  });

  it('50 concurrent checkouts never use a 5-use code more than 5 times', async () => {
    await promo({ code: 'FIRST5', kind: 'percent', percentBps: 5000, maxRedemptions: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) => buy([{ ticketTypeId: ga.id, quantity: 1 }], 'FIRST5', `race${i}`)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ details: { reason: 'promo_invalid' } });
    }
    expect(await used('FIRST5')).toBe(5);
  });

  it('an expired hold gives its use back', async () => {
    await promo({ code: 'ONEUSE', kind: 'amount', amountMinor: 500, maxRedemptions: 1 });
    await buy([{ ticketTypeId: ga.id, quantity: 1 }], 'ONEUSE', 'lapsed');
    expect(await used('ONEUSE')).toBe(1);
    await withTenant(a.ctx(), (tx) =>
      tx.execute(
        sql`update orders.orders set expires_at = now() - interval '1 minute' where promo_code = 'ONEUSE'`,
      ),
    );
    await executeCommand(expireOrdersCommand, {}, systemCtx(a.org.id), ports);
    expect(await used('ONEUSE')).toBe(0);
    await expect(buy([{ ticketTypeId: ga.id, quantity: 1 }], 'ONEUSE', 'second')).resolves.toBeTruthy();
  });

  it('rejects duplicate codes and bad values; viewers cannot create; org B sees none', async () => {
    await expect(promo({ code: 'EARLY20', kind: 'percent', percentBps: 100 })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(promo({ code: 'x', kind: 'percent', percentBps: 100 })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      promo({ code: 'BOTH', kind: 'percent', percentBps: 100, amountMinor: 5 }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        createPromoCodeCommand,
        { eventId, code: 'VIEWER', kind: 'percent', percentBps: 100 },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await executeQuery(listPromoCodesQuery, { eventId }, b.ctx(), ports)).toEqual([]);
  });
});
