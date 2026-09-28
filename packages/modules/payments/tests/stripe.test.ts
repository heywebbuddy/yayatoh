import { describe, expect, it } from 'vitest';
import { stripePaymentProvider } from '../src/index.ts';
import { fakeStripeApi, type StripeRoute, signStripeEvent } from '../src/testing.ts';

const SECRET = 'whsec_platform_0123456789abcdef';
const CONNECT_SECRET = 'whsec_connect_0123456789abcdef';
const NOW = new Date('2027-05-01T12:00:00Z');
const ORG = '0199a1b2-0000-7000-8000-000000000001';
const ORDER = '0199a1b2-0000-7000-8000-000000000002';

/** The adapter over a fake Stripe API that records every request. */
function fakeStripe(routes: Record<string, StripeRoute>) {
  const api = fakeStripeApi(routes);
  const provider = stripePaymentProvider({
    secretKey: 'sk_test_fake',
    webhookSecrets: [SECRET, CONNECT_SECRET],
    fetch: api.fetch,
    now: () => NOW,
  });
  return { provider, calls: api.calls };
}

const signed = (event: Record<string, unknown>, secret = SECRET) => signStripeEvent(event, secret);

const session = (over: Record<string, unknown> = {}) => ({
  id: 'cs_test_1',
  object: 'checkout.session',
  amount_total: 5250,
  currency: 'usd',
  payment_status: 'paid',
  payment_intent: 'pi_1',
  url: 'https://checkout.stripe.com/c/pay/cs_test_1',
  metadata: { orgId: ORG, orderId: ORDER, fundsFlow: 'organizer_mor' },
  ...over,
});

const payment = {
  orgId: ORG,
  orderId: ORDER,
  amount: { amount: 5250, currency: 'USD' },
  applicationFee: { amount: 250, currency: 'USD' },
  buyerEmail: 'ada@example.test',
  description: 'Lakeside Jazz Night',
  idempotencyKey: `order:${ORDER}:1`,
  returnUrl: 'http://localhost:3100/orders/tok',
};

describe('Stripe adapter — charges (roadmap §5.3)', () => {
  it('organizer_mor: a direct-charge Checkout Session on the connected account with the application fee', async () => {
    const { provider, calls } = fakeStripe({ 'POST /v1/checkout/sessions': () => ({ json: session() }) });
    const out = await provider.createPayment({
      ...payment,
      fundsFlow: 'organizer_mor',
      connectedAccountId: 'acct_org',
    });
    expect(out).toEqual({
      providerPaymentId: 'cs_test_1',
      redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    const [c] = calls;
    expect(c?.account).toBe('acct_org');
    expect(c?.idempotencyKey).toBe(`order:${ORDER}:1`);
    expect(Object.fromEntries(c?.body ?? [])).toMatchObject({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '5250',
      'line_items[0][price_data][product_data][name]': 'Lakeside Jazz Night',
      customer_email: 'ada@example.test',
      client_reference_id: ORDER,
      'metadata[orgId]': ORG,
      'metadata[orderId]': ORDER,
      'payment_intent_data[application_fee_amount]': '250',
      'payment_intent_data[metadata][orderId]': ORDER,
      success_url: payment.returnUrl,
      cancel_url: payment.returnUrl,
      // Never Stripe as merchant of record (accounts can default Managed Payments on, M1.5e3).
      'managed_payments[enabled]': 'false',
      // Stripe's minimum session life (30 min), from the injected clock.
      expires_at: String(NOW.getTime() / 1000 + 1800),
    });
  });

  it('platform_mor: a platform charge — no Stripe-Account, no application fee', async () => {
    const { provider, calls } = fakeStripe({ 'POST /v1/checkout/sessions': () => ({ json: session() }) });
    await provider.createPayment({ ...payment, fundsFlow: 'platform_mor', connectedAccountId: null });
    expect(calls[0]?.account).toBeNull();
    expect(calls[0]?.body.has('payment_intent_data[application_fee_amount]')).toBe(false);
  });

  it('refuses impossible charges and live keys outside production', async () => {
    const { provider } = fakeStripe({});
    await expect(
      provider.createPayment({ ...payment, fundsFlow: 'organizer_mor', connectedAccountId: null }),
    ).rejects.toThrow(/connected account/);
    await expect(
      provider.createPayment({
        ...payment,
        fundsFlow: 'organizer_mor',
        connectedAccountId: 'acct_org',
        applicationFee: { amount: 6000, currency: 'USD' },
      }),
    ).rejects.toThrow(/fee exceeds/);
    expect(() => stripePaymentProvider({ secretKey: 'sk_live_x', webhookSecrets: [SECRET] })).toThrow(
      /Live Stripe keys/,
    );
    expect(() => stripePaymentProvider({ secretKey: 'sk_test_x', webhookSecrets: [] })).toThrow(
      /webhook secret/,
    );
  });
});

describe('Stripe adapter — webhooks (verified on the raw body)', () => {
  it('a paid Checkout Session becomes payment.succeeded; currency upper-cased', async () => {
    const { provider } = fakeStripe({});
    const { payload, headers } = await signed({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: session() },
    });
    expect(await provider.verifyWebhook(payload, headers)).toEqual({
      provider: 'stripe',
      id: 'evt_1',
      type: 'payment.succeeded',
      providerPaymentId: 'cs_test_1',
      amountMinor: 5250,
      currency: 'USD',
      orgId: ORG,
      orderId: ORDER,
    });
  });

  it("accepts the Connect endpoint's secret too (direct charges' events come from connected accounts)", async () => {
    const { provider } = fakeStripe({});
    const { payload, headers } = await signed(
      { id: 'evt_c', account: 'acct_org', type: 'checkout.session.completed', data: { object: session() } },
      CONNECT_SECRET,
    );
    expect((await provider.verifyWebhook(payload, headers)).type).toBe('payment.succeeded');
  });

  it('async payments: pending is ignored, then succeeded or failed; an expired session fails', async () => {
    const { provider } = fakeStripe({});
    const cases: [string, Record<string, unknown>, string][] = [
      ['checkout.session.completed', { payment_status: 'unpaid' }, 'ignored'],
      ['checkout.session.async_payment_succeeded', {}, 'payment.succeeded'],
      ['checkout.session.async_payment_failed', { payment_status: 'unpaid' }, 'payment.failed'],
      ['checkout.session.expired', { payment_status: 'unpaid', payment_intent: null }, 'payment.failed'],
    ];
    for (const [type, over, expected] of cases) {
      const { payload, headers } = await signed({ id: `evt_${type}`, type, data: { object: session(over) } });
      expect((await provider.verifyWebhook(payload, headers)).type).toBe(expected);
    }
  });

  it('rejects a bad or missing signature and a tampered body', async () => {
    const { provider } = fakeStripe({});
    const { payload, headers } = await signed({
      id: 'evt_x',
      type: 'checkout.session.completed',
      data: { object: session() },
    });
    await expect(provider.verifyWebhook(payload.replace('5250', '1'), headers)).rejects.toThrow(/signature/);
    await expect(provider.verifyWebhook(payload, new Headers())).rejects.toThrow(/Stripe-Signature/);
    const other = await signed(
      { id: 'evt_y', type: 'checkout.session.completed', data: { object: session() } },
      'whsec_someone_else',
    );
    await expect(provider.verifyWebhook(other.payload, other.headers)).rejects.toThrow(/signature/);
  });

  it("other apps' sessions and unknown event types are acknowledged and ignored", async () => {
    const { provider } = fakeStripe({});
    const foreign = await signed({
      id: 'evt_f',
      type: 'checkout.session.completed',
      data: { object: session({ metadata: {} }) },
    });
    expect(await provider.verifyWebhook(foreign.payload, foreign.headers)).toMatchObject({
      type: 'ignored',
      reason: 'not a Yayatoh order',
    });
    const unknown = await signed({
      id: 'evt_u',
      type: 'customer.created',
      data: { object: { id: 'cus_1', object: 'customer' } },
    });
    expect(await provider.verifyWebhook(unknown.payload, unknown.headers)).toMatchObject({ type: 'ignored' });
  });

  it('account.updated is normalized with its org and de-duplicated requirements', async () => {
    const { provider } = fakeStripe({});
    const { payload, headers } = await signed({
      id: 'evt_a',
      account: 'acct_org',
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_org',
          object: 'account',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: true,
          country: 'US',
          default_currency: 'usd',
          metadata: { orgId: ORG },
          requirements: {
            currently_due: ['external_account'],
            past_due: ['external_account', 'tos_acceptance.date'],
          },
        },
      },
    });
    expect(await provider.verifyWebhook(payload, headers)).toEqual({
      provider: 'stripe',
      id: 'evt_a',
      type: 'account.updated',
      orgId: ORG,
      account: {
        accountId: 'acct_org',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
        requirementsDue: ['external_account', 'tos_acceptance.date'],
        country: 'US',
        defaultCurrency: 'USD',
      },
    });
  });

  it("disputes resolve the order's session by PaymentIntent, on the right account", async () => {
    const { provider, calls } = fakeStripe({
      'GET /v1/checkout/sessions': () => ({ json: { object: 'list', data: [session()], has_more: false } }),
    });
    const dispute = (status: string) => ({
      id: 'dp_1',
      object: 'dispute',
      amount: 5250,
      currency: 'usd',
      reason: 'fraudulent',
      status,
      payment_intent: 'pi_1',
      evidence_details: { due_by: 1_800_000_000 },
    });
    const created = await signed({
      id: 'evt_d1',
      account: 'acct_org',
      type: 'charge.dispute.created',
      data: { object: dispute('needs_response') },
    });
    expect(await provider.verifyWebhook(created.payload, created.headers)).toEqual({
      provider: 'stripe',
      id: 'evt_d1',
      type: 'dispute.created',
      orgId: ORG,
      providerPaymentId: 'cs_test_1',
      providerDisputeId: 'dp_1',
      amountMinor: 5250,
      currency: 'USD',
      reason: 'fraudulent',
      evidenceDueBy: new Date(1_800_000_000_000).toISOString(),
    });
    expect(calls[0]?.query.get('payment_intent')).toBe('pi_1');
    expect(calls[0]?.account).toBe('acct_org');
    const won = await signed({
      id: 'evt_d2',
      type: 'charge.dispute.closed',
      data: { object: dispute('won') },
    });
    expect(await provider.verifyWebhook(won.payload, won.headers)).toMatchObject({
      type: 'dispute.closed',
      outcome: 'won',
    });
    expect(calls[1]?.account).toBeNull();
    const warning = await signed({
      id: 'evt_d3',
      type: 'charge.dispute.closed',
      data: { object: dispute('warning_closed') },
    });
    expect(await provider.verifyWebhook(warning.payload, warning.headers)).toMatchObject({ type: 'ignored' });
  });
});

describe('Stripe adapter — refunds, transfers, disputes, Connect', () => {
  it("organizer_mor refund: on the connected account, then exactly the policy's share of the application fee", async () => {
    const { provider, calls } = fakeStripe({
      'GET /v1/checkout/sessions/cs_test_1': () => ({ json: session() }),
      'POST /v1/refunds': () => ({ json: { id: 're_1', object: 'refund', status: 'succeeded' } }),
      'GET /v1/payment_intents/pi_1': () => ({
        json: {
          id: 'pi_1',
          object: 'payment_intent',
          latest_charge: { id: 'ch_1', object: 'charge', application_fee: 'fee_1' },
        },
      }),
      'POST /v1/application_fees/fee_1/refunds': () => ({ json: { id: 'fr_1', object: 'fee_refund' } }),
    });
    const out = await provider.refund({
      providerPaymentId: 'cs_test_1',
      amount: { amount: 2500, currency: 'USD' },
      connectedAccountId: 'acct_org',
      refundApplicationFee: { amount: 125, currency: 'USD' },
      idempotencyKey: 'refund:r1',
    });
    expect(out).toEqual({ refundId: 're_1', status: 'succeeded' });
    const [retrieve, refund, intent, fee] = calls;
    expect(retrieve?.account).toBe('acct_org');
    expect(refund).toMatchObject({ account: 'acct_org', idempotencyKey: 'refund:r1' });
    // Tagged with the ledger reference (the idempotency key) for daily reconciliation.
    expect(Object.fromEntries(refund?.body ?? [])).toEqual({
      payment_intent: 'pi_1',
      amount: '2500',
      'metadata[yayatoh_ref]': 'refund:r1',
    });
    expect([...(intent?.query ?? [])]).toEqual([['expand[0]', 'latest_charge']]);
    // Application fees live on the platform account.
    expect(fee).toMatchObject({ account: null, idempotencyKey: 'refund:r1:fee' });
    expect(fee?.body.get('amount')).toBe('125');
    expect(fee?.body.get('metadata[yayatoh_ref]')).toBe('refund:r1');
  });

  it('platform_mor refund keeps the fee on the platform; pending and rejected refunds are reported', async () => {
    const { provider, calls } = fakeStripe({
      'GET /v1/checkout/sessions/cs_test_1': () => ({ json: session() }),
      'POST /v1/refunds': (c) =>
        c.body.get('amount') === '999999'
          ? {
              status: 400,
              json: {
                error: { type: 'invalid_request_error', code: 'amount_too_large', message: 'too large' },
              },
            }
          : { json: { id: 're_2', object: 'refund', status: 'pending' } },
    });
    const base = {
      providerPaymentId: 'cs_test_1',
      connectedAccountId: null,
      refundApplicationFee: { amount: 0, currency: 'USD' },
    };
    expect(
      await provider.refund({ ...base, amount: { amount: 100, currency: 'USD' }, idempotencyKey: 'k1' }),
    ).toEqual({ refundId: 're_2', status: 'pending' });
    expect(calls.map((c) => c.account)).toEqual([null, null]);
    expect(
      (await provider.refund({ ...base, amount: { amount: 999_999, currency: 'USD' }, idempotencyKey: 'k2' }))
        .status,
    ).toBe('failed');
  });

  it('transfers carry the transfer group; reversals are explicit; failures are reported, not thrown', async () => {
    const { provider, calls } = fakeStripe({
      'POST /v1/transfers': (c) =>
        c.body.get('destination') === 'acct_closed'
          ? {
              status: 400,
              json: { error: { type: 'invalid_request_error', code: 'account_closed', message: 'closed' } },
            }
          : { json: { id: 'tr_1', object: 'transfer' } },
      'POST /v1/transfers/tr_1/reversals': (c) =>
        c.body.get('amount') === '500000'
          ? {
              status: 400,
              json: {
                error: { type: 'invalid_request_error', code: 'insufficient_funds', message: 'no funds' },
              },
            }
          : { json: { id: 'trr_1', object: 'transfer_reversal' } },
    });
    const t = {
      amount: { amount: 9000, currency: 'USD' },
      transferGroup: 'event:e1',
      idempotencyKey: 'settle:s1',
    };
    expect(await provider.createTransfer({ ...t, destinationAccountId: 'acct_org', orgId: ORG })).toEqual({
      transferId: 'tr_1',
      status: 'succeeded',
    });
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      amount: '9000',
      currency: 'usd',
      destination: 'acct_org',
      transfer_group: 'event:e1',
      'metadata[yayatoh_ref]': 'settle:s1',
      'metadata[orgId]': ORG,
    });
    expect(calls[0]?.idempotencyKey).toBe('settle:s1');
    expect(await provider.createTransfer({ ...t, destinationAccountId: 'acct_closed' })).toMatchObject({
      status: 'failed',
      failure: 'account_closed',
    });
    expect(
      await provider.reverseTransfer({
        transferId: 'tr_1',
        amount: { amount: 300, currency: 'USD' },
        idempotencyKey: 'rev:1',
      }),
    ).toEqual({ reversalId: 'trr_1', status: 'succeeded' });
    expect(
      await provider.reverseTransfer({
        transferId: 'tr_1',
        amount: { amount: 500_000, currency: 'USD' },
        idempotencyKey: 'rev:2',
      }),
    ).toMatchObject({ status: 'failed' });
  });

  it('dispute evidence is submitted once reviewed (idempotent); an empty summary is refused', async () => {
    const { provider, calls } = fakeStripe({
      'POST /v1/disputes/dp_1': () => ({ json: { id: 'dp_1', object: 'dispute' } }),
    });
    expect(
      await provider.submitDisputeEvidence({
        providerDisputeId: 'dp_1',
        summary: 'Checked in at 19:02',
        idempotencyKey: 'ev:1',
      }),
    ).toEqual({ status: 'submitted' });
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      'evidence[uncategorized_text]': 'Checked in at 19:02',
      submit: 'true',
    });
    expect(calls[0]?.account).toBeNull();
    expect(
      await provider.submitDisputeEvidence({
        providerDisputeId: 'dp_1',
        summary: '  ',
        idempotencyKey: 'ev:2',
      }),
    ).toEqual({ status: 'failed' });
    expect(calls).toHaveLength(1);
  });

  it('organizer_mor evidence: the reviewed packet is uploaded and attached on the connected account', async () => {
    const { provider, calls } = fakeStripe({
      'POST /v1/files': () => ({ json: { id: 'file_1', object: 'file' } }),
      'POST /v1/disputes/dp_2': () => ({ json: { id: 'dp_2', object: 'dispute' } }),
    });
    const bytes = new TextEncoder().encode('%PDF-1.4 packet');
    expect(
      await provider.submitDisputeEvidence({
        providerDisputeId: 'dp_2',
        summary: 'Admitted at the north gate',
        packet: { bytes, filename: 'evidence.pdf' },
        connectedAccountId: 'acct_org',
        idempotencyKey: 'evidence:d2',
      }),
    ).toEqual({ status: 'submitted' });
    const [file, update] = calls;
    expect(file).toMatchObject({
      path: '/v1/files',
      account: 'acct_org',
      idempotencyKey: 'evidence:d2:file',
    });
    expect(update).toMatchObject({ account: 'acct_org', idempotencyKey: 'evidence:d2' });
    expect(update?.body.get('evidence[uncategorized_file]')).toBe('file_1');
    // Over the networks' 4.5 MB limit: refused before anything is sent.
    expect(
      await provider.submitDisputeEvidence({
        providerDisputeId: 'dp_2',
        summary: 'x',
        packet: { bytes: new Uint8Array(4_500_001), filename: 'big.pdf' },
        idempotencyKey: 'evidence:big',
      }),
    ).toEqual({ status: 'failed' });
    expect(calls).toHaveLength(2);
  });

  it('Connect: a Standard-equivalent account tagged with the org, hosted onboarding, wallet domains once', async () => {
    const { provider, calls } = fakeStripe({
      'POST /v2/core/accounts': () => ({ json: { id: 'acct_new', object: 'v2.core.account' } }),
      'POST /v1/account_links': () => ({
        json: { object: 'account_link', url: 'https://connect.stripe.com/setup/s/x' },
      }),
      'GET /v1/payment_method_domains': (c) => ({
        json: {
          object: 'list',
          has_more: false,
          data:
            c.query.get('domain_name') === 'known.test'
              ? [{ id: 'pmd_known', object: 'payment_method_domain' }]
              : [],
        },
      }),
      'POST /v1/payment_method_domains': () => ({ json: { id: 'pmd_new', object: 'payment_method_domain' } }),
    });
    expect(
      await provider.createConnectedAccount({ orgId: ORG, country: 'US', email: 'owner@org.test' }),
    ).toEqual({ accountId: 'acct_new' });
    expect(calls[0]?.idempotencyKey).toBe(`acct:${ORG}`);
    // Accounts v2 (Stripe refuses v1 creation for new Connect platforms, M1.5e3).
    expect(calls[0]?.json).toEqual({
      contact_email: 'owner@org.test',
      dashboard: 'full',
      identity: { country: 'us' },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      metadata: { orgId: ORG },
    });
    expect(
      await provider.createOnboardingLink({
        orgId: ORG,
        accountId: 'acct_new',
        returnUrl: 'http://x/r',
        refreshUrl: 'http://x/f',
      }),
    ).toEqual({ url: 'https://connect.stripe.com/setup/s/x' });
    expect(Object.fromEntries(calls[1]?.body ?? [])).toEqual({
      account: 'acct_new',
      type: 'account_onboarding',
      return_url: 'http://x/r',
      refresh_url: 'http://x/f',
    });
    expect(await provider.registerPaymentMethodDomain({ hostname: 'known.test', accountId: null })).toEqual({
      id: 'pmd_known',
    });
    expect(
      await provider.registerPaymentMethodDomain({ hostname: 'tickets.org.test', accountId: 'acct_new' }),
    ).toEqual({ id: 'pmd_new' });
    const create = calls.at(-1);
    expect(create).toMatchObject({
      method: 'POST',
      account: 'acct_new',
      idempotencyKey: 'pmd:tickets.org.test:acct_new',
    });
    expect(Object.fromEntries(create?.body ?? [])).toEqual({
      domain_name: 'tickets.org.test',
      enabled: 'true',
    });
  });
});
