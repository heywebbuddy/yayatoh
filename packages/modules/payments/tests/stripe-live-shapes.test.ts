import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripePaymentProvider } from '../src/index.ts';
import { fakeStripeApi, type StripeRoute, signStripeEvent } from '../src/testing.ts';

/**
 * The adapter against payloads captured from Stripe TEST mode (M1.5e3, `stripe:contract --capture`),
 * redacted: ids are stable stand-ins, emails and names removed. These are real shapes, so a
 * mapping that only worked on hand-written JSON fails here.
 */
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/stripe/${name}.json`, import.meta.url), 'utf8'));
const SECRET = 'whsec_fixture_0123456789abcdef';

function adapter(routes: Record<string, StripeRoute>) {
  const api = fakeStripeApi(routes);
  return {
    provider: stripePaymentProvider({
      secretKey: 'sk_test_fake',
      webhookSecrets: [SECRET],
      fetch: api.fetch,
    }),
    calls: api.calls,
  };
}

describe('balance transactions (daily reconciliation) — real shapes', () => {
  const bts = fixture('balance_transactions') as { type: string; source: Record<string, unknown> }[];
  const charge = (id: string) => bts.find((b) => b.source.id === id)?.source;
  const ORG = 'f79302d1-446c-7662-87db-bf1d7d17a85f';

  it('attributes every movement to the org and the ledger reference, including reversals and fee refunds', async () => {
    const { provider, calls } = adapter({
      'GET /v1/balance_transactions': () => ({
        json: { object: 'list', data: bts, has_more: false, url: '/v1/balance_transactions' },
      }),
      // The disputed charge on the platform (the dispute's source only names it).
      'GET /v1/charges/ch_655ff8fc7ec8591e': () => ({ json: charge('ch_655ff8fc7ec8591e') }),
      // The direct charge behind the application fee lives on the connected account.
      'GET /v1/charges/ch_0742e40e3bd09c06': () => ({
        json: {
          id: 'ch_0742e40e3bd09c06',
          object: 'charge',
          metadata: {
            orgId: ORG,
            orderId: '0199a1b2-0000-7000-8000-00000000d1c7',
            fundsFlow: 'organizer_mor',
          },
        },
      }),
    });
    const out = await provider.listBalanceTransactions({
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2027-01-01T00:00:00Z'),
    });
    const got = (out ?? []).map((b) => [b.kind, b.amountMinor, b.reference, b.orgId]);
    expect(got).toEqual([
      ['dispute', -1500, 'dispute:du_3847eea1cbf0eb53', ORG],
      ['charge', 1500, 'order:13783952-642f-7398-8b5a-21794f23f81a', ORG],
      // Regression (M1.5e3): the reversal's source is the transfer; the reference is the reversal's.
      ['transfer_reversal', 1000, 'reversal:ea8d8ccb-936f-7685-8910-fc89aaf971f1', ORG],
      ['transfer', -3000, 'settlement:16d8694f-cbf3-7735-80c3-25ee3d51f8cc', ORG],
      ['refund', -1000, 'refund:b53e82c2-5c66-7d15-8398-6aa1e77b200a', ORG],
      ['charge', 10000, 'order:5e72af5c-44f5-7649-8874-3372f69df546', ORG],
      // Regression (M1.5e3): the fee refund's source is the fee; the reference is the refund's.
      ['application_fee_refund', -200, 'refund:48cf932c-7e5a-7b9b-8047-60ff31205e2f', ORG],
      ['application_fee', 500, 'order:0199a1b2-0000-7000-8000-00000000d1c7', ORG],
    ]);
    expect(out?.every((b) => b.currency === 'USD')).toBe(true);
    const list = calls.find((c) => c.path === '/v1/balance_transactions');
    expect(list?.query.get('expand[0]')).toBe('data.source');
    expect(calls.find((c) => c.path === '/v1/charges/ch_0742e40e3bd09c06')?.account).toBe(
      'acct_4965237f0d72f3ab',
    );
  });
});

describe('webhooks — real shapes through the verifier', () => {
  const sign = (e: Record<string, unknown>) => signStripeEvent(e, SECRET);

  it('a completed hosted Checkout Session (paid with 4242 in test mode) is payment.succeeded', async () => {
    const { provider } = adapter({});
    const { payload, headers } = await sign(fixture('checkout.session.completed'));
    expect(await provider.verifyWebhook(payload, headers)).toMatchObject({
      type: 'payment.succeeded',
      providerPaymentId: 'cs_test_515c9c77d3e00869',
      amountMinor: 1250,
      currency: 'USD',
      orgId: '0bad13c0-1c55-7d22-8a9c-97c02a3ff5d2',
      orderId: 'bb98801d-c7fc-7607-849f-3b8d6941d91e',
    });
  });

  it('an expired session is payment.failed', async () => {
    const { provider } = adapter({});
    const { payload, headers } = await sign(fixture('checkout.session.expired'));
    expect((await provider.verifyWebhook(payload, headers)).type).toBe('payment.failed');
  });

  it('disputes resolve through the session of their payment; one without a Yayatoh session is ignored', async () => {
    const session = {
      id: 'cs_test_x',
      object: 'checkout.session',
      metadata: { orgId: 'org-1', orderId: 'o-1' },
    };
    let sessions: unknown[] = [session];
    const { provider, calls } = adapter({
      'GET /v1/checkout/sessions': () => ({ json: { object: 'list', data: sessions, has_more: false } }),
    });
    const created = await sign(fixture('charge.dispute.created'));
    expect(await provider.verifyWebhook(created.payload, created.headers)).toMatchObject({
      type: 'dispute.created',
      orgId: 'org-1',
      providerPaymentId: 'cs_test_x',
      providerDisputeId: 'du_3847eea1cbf0eb53',
      amountMinor: 1500,
      currency: 'USD',
      reason: 'fraudulent',
      evidenceDueBy: new Date(1791331199 * 1000).toISOString(),
    });
    expect(calls[0]?.query.get('payment_intent')).toBe('pi_7c3f4ac077cf98b4');
    const closed = await sign(fixture('charge.dispute.closed'));
    expect(await provider.verifyWebhook(closed.payload, closed.headers)).toMatchObject({
      type: 'dispute.closed',
      outcome: 'won',
    });
    sessions = [];
    expect(await provider.verifyWebhook(created.payload, created.headers)).toMatchObject({
      type: 'ignored',
      reason: 'not a Yayatoh order',
    });
  });
});
