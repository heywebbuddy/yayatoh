import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { checkoutRiskSignals, orderDetailQuery, startCheckoutCommand } from '@yayatoh/orders';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs } from '../src/index.ts';

/** Pre-checkout risk (M1.6e): per-org signals for the rules, and the review flag on the order. */
let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('checkout risk (M1.6e)', () => {
  it('counts the email’s recent orders in this org only; a review is recorded on the order', async () => {
    const [type] = await executeQuery(listTicketTypesQuery, { eventId: a.event.id }, a.ctx(), ports);
    const email = `risky.${Date.now()}@example.test`;
    const now = new Date();
    expect(await checkoutRiskSignals(a.org.id, a.event.id, email, now)).toMatchObject({
      emailOrders: 0,
      paymentFailures: 0,
    });
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId: a.event.id,
        items: [{ ticketTypeId: type?.id ?? '', quantity: 1 }],
        buyer: { email: email.toUpperCase(), name: 'Rich Risky' },
        riskReview: ['country_mismatch_review'],
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    expect(await checkoutRiskSignals(a.org.id, a.event.id, email, now)).toMatchObject({ emailOrders: 1 });
    // Another org never counts this org's orders.
    expect(await checkoutRiskSignals(b.org.id, b.event.id, email, now)).toMatchObject({ emailOrders: 0 });
    const detail = await executeQuery(orderDetailQuery, { orderId: c.order.id }, a.ctx(), ports);
    expect(detail.riskReview).toEqual(['country_mismatch_review']);
    await expect(
      executeCommand(
        startCheckoutCommand,
        {
          eventId: a.event.id,
          items: [{ ticketTypeId: type?.id ?? '', quantity: 1 }],
          buyer: { email, name: 'Rich Risky' },
          riskReview: ['DROP TABLE'],
        },
        createCtx({ orgId: a.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
