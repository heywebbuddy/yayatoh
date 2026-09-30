import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { checkoutTarget, createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  expireOrdersCommand,
  listOrdersQuery,
  orderByManageToken,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let slug: string;
let ga: { id: string };
let free: { id: string };

const anon = () => createCtx({ orgId: a.org.id });
const buyer = (n: number | string) => ({ email: `Buyer${n}@Example.test`, name: `Buyer ${n}` });
const checkout = (
  items: { ticketTypeId: string; quantity: number }[],
  n: number | string = 1,
  ctx = anon(),
) => executeCommand(startCheckoutCommand, { eventId, items, buyer: buyer(n) }, ctx, ports);
const soldHeld = async (id: string) => {
  const t = (await executeQuery(listTicketTypesQuery, { eventId }, a.ctx(), ports)).find((x) => x.id === id);
  return [t?.quantitySold, t?.quantityHeld];
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Checkout ${a.org.slug}`,
      timezone: 'UTC',
      startsAt: '2027-12-01T18:00:00Z',
      endsAt: '2027-12-01T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  slug = e.slug;
  ga = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'GA', priceMinor: 5000, quantityTotal: 10, maxPerOrder: 4 },
    a.ctx(),
    ports,
  );
  free = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Free', priceMinor: 0, quantityTotal: 100 },
    a.ctx(),
    ports,
  );
});
afterAll(closePools);

describe('checkout', () => {
  it('refuses checkout for an unpublished event and resolves only published slugs', async () => {
    await expect(checkout([{ ticketTypeId: ga.id, quantity: 1 }])).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await checkoutTarget(slug)).toBeNull();
    await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
    expect(await checkoutTarget(slug)).toEqual({ orgId: a.org.id, eventId });
  });

  it('a free order is paid immediately and moves inventory to sold', async () => {
    const r = await checkout([{ ticketTypeId: free.id, quantity: 2 }], 'free');
    expect(r.order).toMatchObject({ status: 'paid', totalMinor: 0, buyerEmail: 'buyerfree@example.test' });
    expect(await soldHeld(free.id)).toEqual([2, 0]);
    expect(r.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('a paid order holds stock, snapshots totals, and becomes paid only from a verified provider event', async () => {
    const r = await checkout([{ ticketTypeId: ga.id, quantity: 2 }], 'paid');
    expect(r.order).toMatchObject({ status: 'reserved', subtotalMinor: 10000, totalMinor: 10000 });
    expect(await soldHeld(ga.id)).toEqual([0, 2]);
    await executeCommand(
      attachPaymentCommand,
      { orderId: r.order.id, provider: 'fake', providerPaymentId: 'fakepi_x1' },
      anon(),
      ports,
    );
    const event = {
      provider: 'fake',
      id: 'fakeevt_x1',
      type: 'payment.succeeded',
      providerPaymentId: 'fakepi_x1',
      amountMinor: 10000,
      currency: 'USD',
      orgId: a.org.id,
      orderId: r.order.id,
    };
    // A browser cannot mark an order paid: the provider-event command is platform-only.
    await expect(executeCommand(applyProviderEventCommand, event, anon(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await executeCommand(applyProviderEventCommand, event, systemCtx(a.org.id), ports)).toEqual({
      outcome: 'applied',
      status: 'paid',
    });
    // Duplicate webhooks fulfil once.
    expect(await executeCommand(applyProviderEventCommand, event, systemCtx(a.org.id), ports)).toMatchObject({
      outcome: 'duplicate',
    });
    expect(await soldHeld(ga.id)).toEqual([2, 0]);
    // A mismatched amount is rejected.
    await expect(
      executeCommand(
        applyProviderEventCommand,
        { ...event, id: 'fakeevt_x2', amountMinor: 1 },
        systemCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('the guest order page works by manage token only, with allowlisted fields', async () => {
    const r = await checkout([{ ticketTypeId: free.id, quantity: 1 }], 'guest');
    const page = await orderByManageToken(r.manageToken);
    expect(page).toMatchObject({ id: r.order.id, status: 'paid', buyerName: 'Buyer guest' });
    expect(Object.keys(page ?? {})).not.toContain('manageTokenHash');
    expect(await orderByManageToken('x'.repeat(43))).toBeNull();
  });

  it('enforces per-order limits', async () => {
    await expect(checkout([{ ticketTypeId: ga.id, quantity: 5 }])).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('200 concurrent buyers for the last tickets never oversell', async () => {
    const [sold] = await soldHeld(ga.id);
    const left = 10 - (sold as number);
    const results = await Promise.allSettled(
      Array.from({ length: 200 }, (_, i) => checkout([{ ticketTypeId: ga.id, quantity: 1 }], `race${i}`)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(left);
    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(failures.every((f) => (f.reason as { code?: string }).code === 'conflict')).toBe(true);
    expect(await soldHeld(ga.id)).toEqual([sold, left]);
  });

  it('the sweeper releases expired holds', async () => {
    await withTenant(a.ctx(), (tx) =>
      tx.execute(
        sql`update orders.orders set expires_at = now() - interval '1 minute' where status = 'reserved'`,
      ),
    );
    const r = await executeCommand(expireOrdersCommand, {}, systemCtx(a.org.id), ports);
    expect(r.expired).toBeGreaterThan(0);
    const [, held] = await soldHeld(ga.id);
    expect(held).toBe(0);
  });

  it('isolation: org B cannot read org A orders or check out into its events', async () => {
    const mine = await executeQuery(listOrdersQuery, { eventId: b.event.id }, b.ctx(), ports);
    expect(mine.every((o) => o.eventId === b.event.id)).toBe(true);
    expect(await executeQuery(listOrdersQuery, { eventId }, b.ctx(), ports)).toEqual([]);
    await expect(
      executeCommand(
        startCheckoutCommand,
        { eventId, items: [{ ticketTypeId: ga.id, quantity: 1 }], buyer: buyer('x') },
        createCtx({ orgId: b.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
