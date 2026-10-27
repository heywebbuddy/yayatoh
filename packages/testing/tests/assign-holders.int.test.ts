import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  assignHoldersCommand,
  attachPaymentCommand,
  orderByManageToken,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let eventId: string;
let ga: string;

async function paidOrder(n: string, quantity: number) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: ga, quantity }],
      buyer: { email: `buyer-${n}@example.test`, name: `Buyer ${n}` },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_holders_${r.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${pi}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: r.order.totalMinor,
      currency: r.order.currency,
      orgId: a.org.id,
      orderId: r.order.id,
    },
    systemCtx(a.org.id),
    ports,
  );
  return r.manageToken;
}

beforeAll(async () => {
  ({ a } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Holders night',
        timezone: 'UTC',
        startsAt: '2028-09-01T18:00:00Z',
        endsAt: '2028-09-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  ga = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 2000, quantityTotal: 50, transfersAllowed: true },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('name all holders at once', () => {
  it('offers each other person their own ticket, and only names the buyer’s own', async () => {
    const token = await paidOrder('h1', 3);
    const order = await orderByManageToken(token);
    const ids = order?.tickets.map((t) => t.id) ?? [];
    expect(ids).toHaveLength(3);
    const r = await executeCommand(
      assignHoldersCommand,
      {
        manageToken: token,
        holders: [
          { ticketId: ids[0] ?? '', name: 'Buyer H1 (me)', email: 'buyer-h1@example.test' },
          { ticketId: ids[1] ?? '', name: 'Guest Two', email: 'two@example.test' },
          { ticketId: ids[2] ?? '', name: 'Guest Three', email: 'three@example.test' },
        ],
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    expect(r.named).toBe(1);
    expect(r.offered.map((o) => o.toEmail).sort()).toEqual(['three@example.test', 'two@example.test']);
    const after = await orderByManageToken(token);
    expect(after?.pendingHolders.map((p) => p.toEmail).sort()).toEqual([
      'three@example.test',
      'two@example.test',
    ]);
    // The tickets stay valid and with the buyer until the guests claim them.
    expect(after?.tickets).toHaveLength(3);
  });

  it('refuses a ticket that is not in the order', async () => {
    const token = await paidOrder('h2', 1);
    await expect(
      executeCommand(
        assignHoldersCommand,
        {
          manageToken: token,
          holders: [{ ticketId: '00000000-0000-4000-8000-000000000000', name: 'X', email: 'x@example.test' }],
        },
        createCtx({ orgId: a.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
