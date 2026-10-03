import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, setEventCurrencyCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { createPromoCodeCommand, createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/** U9 (UX-6): the per-event currency, locked after the first sale. */
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

async function event(name: string, currency?: string) {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      timezone: 'UTC',
      startsAt: '2027-12-01T18:00:00Z',
      endsAt: '2027-12-01T23:00:00Z',
      ...(currency ? { currency } : {}),
    },
    a.ctx(),
    ports,
  );
  const ga = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 2500, quantityTotal: 500, maxPerOrder: 10 },
    a.ctx(),
    ports,
  );
  return { ...e, ga: ga.id };
}
const setCurrency = (eventId: string, currency: string, ctx = a.ctx()) =>
  executeCommand(setEventCurrencyCommand, { eventId, currency }, ctx, ports);
const buy = (e: { id: string; ga: string }, who = 'buyer') =>
  executeCommand(
    startCheckoutCommand,
    { eventId: e.id, items: [{ ticketTypeId: e.ga, quantity: 1 }], buyer: { email: `${who}@example.test`, name: who } },
    createCtx({ orgId: a.org.id }),
    ports,
  );
const currencies = (eventId: string) =>
  withTenant(a.ctx(), async (tx) => {
    const one = async (q: ReturnType<typeof sql>) =>
      (await tx.execute<{ c: string }>(q)).map((r) => r.c);
    return {
      event: await one(sql`select currency as c from events.events where id = ${eventId}`),
      ticketTypes: await one(sql`select distinct currency as c from ticketing.ticket_types where event_id = ${eventId}`),
      promos: await one(sql`select distinct currency as c from ticketing.promo_codes where event_id = ${eventId}`),
      orders: await one(sql`select distinct currency as c from orders.orders where event_id = ${eventId}`),
    };
  });

describe('event currency', () => {
  it('is chosen at creation and checkout charges in it', async () => {
    const e = await event('Euro night', 'EUR');
    expect(e.currency).toBe('EUR');
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
    const r = await buy(e, 'euro');
    expect(r.order.currency).toBe('EUR');
  });

  it('changes before the first sale; ticket types and promo codes follow it', async () => {
    const e = await event('Before sale');
    await executeCommand(
      createPromoCodeCommand,
      { eventId: e.id, code: `CUR${Date.now() % 100000}`, kind: 'amount', amountMinor: 100 },
      a.ctx(),
      ports,
    );
    const changed = await setCurrency(e.id, 'GBP');
    expect(changed.currency).toBe('GBP');
    expect(await currencies(e.id)).toEqual({ event: ['GBP'], ticketTypes: ['GBP'], promos: ['GBP'], orders: [] });
    // Same currency again is a no-op.
    await expect(setCurrency(e.id, 'GBP')).resolves.toMatchObject({ currency: 'GBP' });
  });

  it('is locked once an order exists (even one still unpaid)', async () => {
    const e = await event('After sale');
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
    await buy(e, 'first');
    await expect(setCurrency(e.id, 'EUR')).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'currency_locked', field: 'currency' },
    });
    expect(await currencies(e.id)).toEqual({ event: ['USD'], ticketTypes: ['USD'], promos: [], orders: ['USD'] });
  });

  it('a change racing checkouts never leaves an order in another currency than its event', async () => {
    const e = await event('Race');
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
    const results = await Promise.allSettled([
      ...Array.from({ length: 8 }, (_, i) => buy(e, `racer${i}`)),
      setCurrency(e.id, 'CAD'),
    ]);
    const change = results.at(-1);
    const sold = results.slice(0, -1).filter((r) => r.status === 'fulfilled').length;
    const c = await currencies(e.id);
    // Totals never mix: every order is in the event's (final) currency, as are its ticket types.
    expect(c.ticketTypes).toEqual(c.event);
    if (c.orders.length) expect(c.orders).toEqual(c.event);
    if (change?.status === 'fulfilled') expect(c.event).toEqual(['CAD']);
    else expect(sold).toBeGreaterThan(0);
  });

  it('needs events:write; another org cannot reach the event', async () => {
    const e = await event('Guarded');
    await expect(setCurrency(e.id, 'EUR', userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(setCurrency(e.id, 'EUR', b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(setCurrency(e.id, 'euro')).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
