import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  applyDisputeEventCommand,
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  isDisputeEvent,
  isIgnoredEvent,
  type PaymentProvider,
  type ProviderEvent,
  stripePaymentProvider,
  type WebhookEvent,
} from '@yayatoh/payments';
import { fakeStripeApi, signStripeEvent } from '@yayatoh/payments/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * M1.5e: a platform_mor order paid through the Stripe adapter end to end on a real database —
 * Checkout Session, signed webhook, the order paid once, a refund of the session's payment and a
 * dispute found by its PaymentIntent. Stripe itself is a recording fake (no network).
 */
const SECRET = 'whsec_int_0123456789abcdef';
let a: OrgFixture;
let eventId: string;
let typeId: string;
let provider: PaymentProvider;
const sessions = new Map<string, Record<string, unknown>>();
const api = fakeStripeApi({
  'POST /v1/checkout/sessions': (c) => {
    const id = `cs_test_${sessions.size + 1}`;
    const s = {
      id,
      object: 'checkout.session',
      url: `https://checkout.stripe.com/c/pay/${id}`,
      amount_total: Number(c.body.get('line_items[0][price_data][unit_amount]')),
      currency: c.body.get('line_items[0][price_data][currency]'),
      payment_status: 'paid',
      payment_intent: `pi_${id}`,
      metadata: { orgId: c.body.get('metadata[orgId]'), orderId: c.body.get('metadata[orderId]') },
    };
    sessions.set(id, s);
    return { json: s };
  },
  'GET /v1/checkout/sessions/cs_test_1': () => ({ json: sessions.get('cs_test_1') }),
  'GET /v1/checkout/sessions': (c) => ({
    json: {
      object: 'list',
      has_more: false,
      data: [...sessions.values()].filter((s) => s.payment_intent === c.query.get('payment_intent')),
    },
  }),
  'POST /v1/refunds': () => ({ json: { id: 're_int_1', object: 'refund', status: 'succeeded' } }),
});

const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  withTenant(systemCtx(a.org.id), (tx) => tx.execute<T>(query));

/** What the webhook route does with a verified event (apps/web/src/server/webhooks.ts). */
async function deliver(event: WebhookEvent) {
  if (isIgnoredEvent(event)) return { outcome: 'ignored' };
  const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'webhook:stripe' } });
  return isDisputeEvent(event)
    ? executeCommand(applyDisputeEventCommand, event, ctx, ports)
    : executeCommand(applyProviderEventCommand, event as ProviderEvent, ctx, ports);
}

beforeAll(async () => {
  ({ a } = await twoOrgs());
  provider = stripePaymentProvider({ secretKey: 'sk_test_int', webhookSecrets: [SECRET], fetch: api.fetch });
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Stripe night',
        timezone: 'UTC',
        startsAt: '2028-06-01T18:00:00Z',
        endsAt: '2028-06-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  typeId = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: 'GA', priceMinor: 4000, quantityTotal: 10 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('Stripe checkout end to end (M1.5e)', () => {
  let orderId: string;
  let sessionId: string;
  let total: number;

  it('a Checkout Session is created for the order and the webhook marks it paid exactly once', async () => {
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId: typeId, quantity: 2 }],
        buyer: { email: 'sam@example.test', name: 'Sam Stripe' },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    orderId = c.order.id;
    total = c.order.totalMinor;
    expect(c.payment.fundsFlow).toBe('platform_mor');
    const pay = await provider.createPayment({
      orgId: a.org.id,
      orderId,
      amount: { amount: total, currency: c.order.currency },
      fundsFlow: c.payment.fundsFlow,
      connectedAccountId: c.payment.connectedAccountId,
      applicationFee: { amount: c.payment.applicationFeeMinor, currency: c.order.currency },
      buyerEmail: 'sam@example.test',
      description: 'Stripe night',
      idempotencyKey: `order:${orderId}:1`,
      returnUrl: 'http://localhost/orders/x',
    });
    sessionId = pay.providerPaymentId;
    expect(sessionId).toMatch(/^cs_test_/);
    await executeCommand(
      attachPaymentCommand,
      { orderId, provider: 'stripe', providerPaymentId: sessionId },
      createCtx({ orgId: a.org.id }),
      ports,
    );

    const evt = await signStripeEvent(
      {
        id: `evt_${uuidv7()}`,
        type: 'checkout.session.completed',
        data: { object: sessions.get(sessionId) },
      },
      SECRET,
    );
    expect(await deliver(await provider.verifyWebhook(evt.payload, evt.headers))).toMatchObject({
      outcome: 'applied',
      status: 'paid',
    });
    // Stripe retries deliveries: the same event is applied once.
    expect(await deliver(await provider.verifyWebhook(evt.payload, evt.headers))).toMatchObject({
      outcome: 'duplicate',
    });
    const [row] = await q<{ status: string; provider: string; n: number }>(
      sql`select o.status, o.provider, (select count(*)::int from ticketing.tickets t where t.order_id = o.id) as n
          from orders.orders o where o.id = ${orderId}`,
    );
    expect(row).toEqual({ status: 'paid', provider: 'stripe', n: 2 });
  });

  it('a forged or mismatched event never pays an order', async () => {
    const forged = await signStripeEvent(
      { id: 'evt_forged', type: 'checkout.session.completed', data: { object: sessions.get(sessionId) } },
      'whsec_attacker',
    );
    await expect(provider.verifyWebhook(forged.payload, forged.headers)).rejects.toThrow(/signature/);
    // Correctly signed, but for less money than the order: refused by the order check.
    const cheap = await signStripeEvent(
      {
        id: `evt_${uuidv7()}`,
        type: 'checkout.session.completed',
        data: { object: { ...sessions.get(sessionId), amount_total: 1 } },
      },
      SECRET,
    );
    await expect(deliver(await provider.verifyWebhook(cheap.payload, cheap.headers))).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it("a refund goes to the session's PaymentIntent on the platform account", async () => {
    const [ticket] = await q<{ id: string }>(
      sql`select id from ticketing.tickets where order_id = ${orderId} limit 1`,
    );
    const started = await executeCommand(
      startRefundCommand,
      { orderId, reason: 'requested_by_customer', ticketIds: [ticket?.id ?? ''] },
      a.ctx(),
      ports,
    );
    const res = await provider.refund({
      providerPaymentId: started.provider.providerPaymentId,
      amount: { amount: started.amountMinor, currency: started.currency },
      connectedAccountId: started.provider.connectedAccountId,
      refundApplicationFee: { amount: 0, currency: started.currency },
      idempotencyKey: `refund:${started.refundId}`,
    });
    expect(res).toEqual({ refundId: 're_int_1', status: 'succeeded' });
    const call = api.calls.find((c) => c.path === '/v1/refunds');
    expect(call?.body.get('payment_intent')).toBe(`pi_${sessionId}`);
    expect(call?.account).toBeNull();
    await executeCommand(
      completeRefundCommand,
      {
        refundId: started.refundId,
        outcome: res.status === 'succeeded' ? 'succeeded' : 'failed',
        providerRefundId: res.refundId,
      },
      a.ctx(),
      ports,
    );
    const [row] = await q<{ status: string }>(sql`select status from orders.orders where id = ${orderId}`);
    expect(row?.status).toBe('partially_refunded');
  });

  it('a dispute is matched to the order through its PaymentIntent', async () => {
    const evt = await signStripeEvent(
      {
        id: `evt_${uuidv7()}`,
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_int_1',
            object: 'dispute',
            amount: 1000,
            currency: 'usd',
            reason: 'fraudulent',
            status: 'needs_response',
            payment_intent: `pi_${sessionId}`,
            evidence_details: { due_by: 1_900_000_000 },
          },
        },
      },
      SECRET,
    );
    const out = await deliver(await provider.verifyWebhook(evt.payload, evt.headers));
    expect(out).toMatchObject({ outcome: 'applied' });
    const [row] = await q<{ n: number }>(
      sql`select count(*)::int as n from payments.disputes where provider_dispute_id = 'dp_int_1'`,
    );
    expect(row?.n).toBe(1);
  });

  it("another app's events on the same Stripe account are acknowledged and ignored", async () => {
    const evt = await signStripeEvent(
      {
        id: 'evt_other',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_other', object: 'checkout.session', metadata: {} } },
      },
      SECRET,
    );
    expect(await deliver(await provider.verifyWebhook(evt.payload, evt.headers))).toEqual({
      outcome: 'ignored',
    });
  });
});
