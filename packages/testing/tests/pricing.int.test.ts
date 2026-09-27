import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import {
  createPromoCodeCommand,
  createTicketTypeCommand,
  publicTicketTypes,
  updateTicketTypeCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let eventId: string;
let slug: string;
let early: { id: string };
let donation: { id: string };
let multi: { id: string };

const future = new Date(Date.now() + 7 * 86_400_000).toISOString();

beforeAll(async () => {
  ({ a } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    { name: 'Pricing', timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-03T23:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  slug = e.slug;
  early = await executeCommand(
    createTicketTypeCommand,
    {
      eventId,
      name: 'Early',
      priceMinor: 5000,
      earlyPriceMinor: 3500,
      earlyEndsAt: future,
      quantityTotal: 100,
    },
    a.ctx(),
    ports,
  );
  donation = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Supporter', priceMinor: 1000, isDonation: true, quantityTotal: 100 },
    a.ctx(),
    ports,
  );
  multi = await executeCommand(
    createTicketTypeCommand,
    {
      eventId,
      name: 'Weekend',
      priceMinor: 9000,
      quantityTotal: 100,
      accessDates: [
        { date: '2027-12-03', name: 'Gala Night' },
        { date: '2027-12-01', name: 'Cultural Night' },
      ],
    },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

const buy = (items: { ticketTypeId: string; quantity: number; amountMinor?: number }[], promoCode?: string) =>
  executeCommand(
    startCheckoutCommand,
    { eventId, items, buyer: { email: 'p@example.test', name: 'P' }, promoCode },
    createCtx({ orgId: a.org.id }),
    ports,
  );
const pub = async (id: string) => (await publicTicketTypes(slug)).find((p) => p.id === id);

describe('early-bird, donation and multi-day passes', () => {
  it('the early-bird price is charged and shown (with the regular price) until it ends', async () => {
    expect(await pub(early.id)).toMatchObject({ allInMinor: 3500, regularAllInMinor: 5000 });
    expect((await buy([{ ticketTypeId: early.id, quantity: 2 }])).order.totalMinor).toBe(7000);
    await withTenant(a.ctx(), (tx) =>
      tx.execute(
        sql`update ticketing.ticket_types set early_ends_at = now() - interval '1 second' where id = ${early.id}`,
      ),
    );
    expect(await pub(early.id)).toMatchObject({
      allInMinor: 5000,
      regularAllInMinor: null,
      earlyEndsAt: null,
    });
    expect((await buy([{ ticketTypeId: early.id, quantity: 1 }])).order.totalMinor).toBe(5000);
  });

  it('rejects an early-bird price at or above the regular price, or without an end', async () => {
    const base = { eventId, name: 'Bad', priceMinor: 1000, quantityTotal: 1 };
    await expect(
      executeCommand(
        createTicketTypeCommand,
        { ...base, earlyPriceMinor: 1000, earlyEndsAt: future },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(createTicketTypeCommand, { ...base, earlyPriceMinor: 500 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // An update is checked against the merged row: lowering the price under the early price fails.
    await expect(
      executeCommand(updateTicketTypeCommand, { ticketTypeId: early.id, priceMinor: 3000 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'earlyPriceMinor' } });
  });

  it('a donation pass charges the amount the buyer chose, never below the minimum', async () => {
    expect(await pub(donation.id)).toMatchObject({ isDonation: true, allInMinor: 1000 });
    await expect(buy([{ ticketTypeId: donation.id, quantity: 1 }])).rejects.toMatchObject({
      details: { reason: 'donation_amount', minimum: 1000 },
    });
    await expect(buy([{ ticketTypeId: donation.id, quantity: 1, amountMinor: 999 }])).rejects.toMatchObject({
      details: { reason: 'donation_amount' },
    });
    const r = await buy([{ ticketTypeId: donation.id, quantity: 2, amountMinor: 2500 }]);
    expect(r.order).toMatchObject({ totalMinor: 5000, discountMinor: 0 });
    // A fixed-price pass refuses a buyer-chosen amount.
    await expect(buy([{ ticketTypeId: multi.id, quantity: 1, amountMinor: 1 }])).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('promo codes do not discount donations', async () => {
    await executeCommand(
      createPromoCodeCommand,
      { eventId, code: 'HALF', kind: 'percent', percentBps: 5000 },
      a.ctx(),
      ports,
    );
    await expect(
      buy([{ ticketTypeId: donation.id, quantity: 1, amountMinor: 2000 }], 'HALF'),
    ).rejects.toMatchObject({
      details: { reason: 'promo_invalid' },
    });
  });

  it('access dates are stored sorted, unique, and shown publicly', async () => {
    expect((await pub(multi.id))?.accessDates).toEqual([
      { date: '2027-12-01', name: 'Cultural Night' },
      { date: '2027-12-03', name: 'Gala Night' },
    ]);
    await expect(
      executeCommand(
        createTicketTypeCommand,
        {
          eventId,
          name: 'Dup',
          priceMinor: 100,
          quantityTotal: 1,
          accessDates: [
            { date: '2027-12-01', name: 'A' },
            { date: '2027-12-01', name: 'B' },
          ],
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('an update changes only the fields it names (regression: defaults used to reset the rest)', async () => {
    const updated = await executeCommand(
      updateTicketTypeCommand,
      { ticketTypeId: multi.id, name: 'Weekend pass' },
      a.ctx(),
      ports,
    );
    expect(updated).toMatchObject({ name: 'Weekend pass', priceMinor: 9000, visibility: 'public' });
    expect(updated.accessDates).toHaveLength(2);
  });
});
