import { setFeeOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderDetailQuery, recordBoxOfficeSaleCommand, startRefundCommand } from '@yayatoh/orders';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let publicType: string;
let hiddenType: string;

const sell = (
  ctx = a.ctx(),
  items = [{ ticketTypeId: publicType, quantity: 2 }],
  extra: Record<string, unknown> = {},
) =>
  executeCommand(
    recordBoxOfficeSaleCommand,
    {
      eventId,
      items,
      buyer: { email: 'Walk.Up@Example.test', name: 'Wally Walkup' },
      method: 'zelle',
      reference: 'ZL-123',
      ...extra,
    },
    ctx,
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'test fee' },
    systemCtx(a.org.id),
    ports,
  );
  const e = await executeCommand(
    createEventCommand,
    { name: 'Door sales', timezone: 'UTC', startsAt: '2028-07-01T18:00:00Z', endsAt: '2028-07-01T22:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  publicType = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 5000, quantityTotal: 3 },
      a.ctx(),
      ports,
    )
  ).id;
  hiddenType = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'Comp-at-door', priceMinor: 2000, quantityTotal: 5, visibility: 'hidden' },
      a.ctx(),
      ports,
    )
  ).id;
});
afterAll(closePools);

describe('box office sales (M1.5f)', () => {
  it('needs a published event', async () => {
    await expect(sell()).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_published' },
    });
    await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  });

  it('issues tickets at once, organizer-collected, at the same all-in price, including hidden passes', async () => {
    const { order } = await sell(a.ctx(), [
      { ticketTypeId: publicType, quantity: 2 },
      { ticketTypeId: hiddenType, quantity: 1 },
    ]);
    expect(order).toMatchObject({
      status: 'paid',
      buyerEmail: 'walk.up@example.test',
      totalMinor: 2 * 5550 + 2250,
    });
    const detail = await executeQuery(orderDetailQuery, { orderId: order.id }, a.ctx(), ports);
    expect(detail).toMatchObject({
      collectedBy: 'organizer',
      paymentMethod: 'zelle',
      paymentReference: 'ZL-123',
      createdVia: 'box_office',
    });
    expect(detail.tickets).toHaveLength(3);
    const types = await executeQuery(listTicketTypesQuery, { eventId }, a.ctx(), ports);
    expect(types.find((t) => t.id === publicType)?.quantitySold).toBe(2);
    // The platform fee becomes the organizer's receivable; no cash moves on the platform.
    const [r] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ receivable: string; cash: string | null }>(sql`
        select sum(amount_minor) filter (where account = 'org:receivable')::text as receivable,
               sum(amount_minor) filter (where account = 'platform:stripe_cash')::text as cash
        from payments.postings p join payments.journal_entries j on j.id = p.journal_id where j.ref_id = ${order.id}`),
    );
    expect(r).toEqual({ receivable: String(order.feeMinor), cash: null });
    const [evt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events where type = 'order.paid' and aggregate_id = ${order.id}`,
      ),
    );
    expect(evt?.n).toBe(1);
    // Refunds of money the organizer holds happen in person, not through the provider.
    await expect(
      executeCommand(
        startRefundCommand,
        { orderId: order.id, reason: 'goodwill', amountMinor: 100 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'no_payment' } });
  });

  it('never oversells', async () => {
    await expect(sell()).rejects.toMatchObject({ code: 'conflict' });
  });

  it('box office staff can sell; finance and viewers cannot; other orgs never see it', async () => {
    const door = uuidv7();
    await executeCommand(addMemberCommand, { userId: door, role: 'box_office' }, a.ctx(), ports);
    const { order } = await sell(userCtx(door, a.org.id), [{ ticketTypeId: publicType, quantity: 1 }], {
      method: 'cash',
      reference: undefined,
    });
    expect(order.status).toBe('paid');
    const fin = uuidv7();
    await executeCommand(addMemberCommand, { userId: fin, role: 'finance' }, a.ctx(), ports);
    await expect(
      sell(userCtx(fin, a.org.id), [{ ticketTypeId: hiddenType, quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      sell(userCtx(a.viewerId, a.org.id), [{ ticketTypeId: hiddenType, quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(orderDetailQuery, { orderId: order.id }, b.ctx(), ports)).rejects.toMatchObject(
      { code: 'not_found' },
    );
  });
});
