import { describe, expect, it } from 'vitest';
import {
  type FakeCardStore,
  fakePaymentProvider,
  signFakeSetupWebhook,
  stripePaymentProvider,
} from '../src/index.ts';
import { fakeStripeApi, type StripeRoute, signStripeEvent } from '../src/testing.ts';

const secret = 'saved-cards-test-secret-0123456789abcdef';
const ORG = '0199a1b2-0000-7000-8000-000000000001';
const ORDER = '0199a1b2-0000-7000-8000-000000000002';
const CARD = '0199a1b2-0000-7000-8000-000000000003';

const freshCards = (): FakeCardStore => ({ charges: new Map(), declinedOnce: new Set() });
const fake = (cards = freshCards()) => fakePaymentProvider({ secret, appOrigin: 'https://app.test', cards });

const charge = (paymentMethodId: string, key = `order:${ORDER}:1`) => ({
  orgId: ORG,
  orderId: ORDER,
  amount: { amount: 100_000, currency: 'USD' },
  connectedAccountId: 'fakeacct_1',
  customerId: 'fakecus_1',
  paymentMethodId,
  description: 'Pledge',
  idempotencyKey: key,
});

describe('fake provider — cards on file (M4.8e)', () => {
  it('a setup is a hosted step on the connected account, deterministic per key', async () => {
    const p = fake();
    const input = {
      orgId: ORG,
      reference: CARD,
      connectedAccountId: 'fakeacct_1',
      email: 'ada@example.test',
      name: 'Ada',
      description: 'Gala',
      idempotencyKey: `card:${CARD}`,
      returnUrl: 'https://app.test/back',
    };
    const a = await p.createCardSetup(input);
    const b = await p.createCardSetup(input);
    expect(a).toEqual(b);
    const url = new URL(a.redirectUrl);
    expect(url.pathname).toBe('/checkout/fake/setup');
    expect(url.searchParams.get('ref')).toBe(CARD);
    expect(url.searchParams.get('acct')).toBe('fakeacct_1');
  });

  it('the signed setup webhook verifies and carries references and display details only', async () => {
    const p = fake();
    const { body, signature } = signFakeSetupWebhook(secret, {
      orgId: ORG,
      reference: CARD,
      providerSetupId: 'fakeseti_1',
      connectedAccountId: 'fakeacct_1',
      email: 'Ada@Example.test',
      outcome: 'succeeded',
      card: '4242',
    });
    const e = await p.verifyWebhook(body, new Headers({ 'x-fake-signature': signature }));
    expect(e).toMatchObject({ type: 'setup.succeeded', reference: CARD, brand: 'visa', last4: '4242' });
    expect(JSON.stringify(e)).not.toMatch(/4242424242424242/);
    await expect(p.verifyWebhook(body, new Headers({ 'x-fake-signature': 'bad' }))).rejects.toThrow();
  });

  it('charges once per key: a replay answers the first result', async () => {
    const p = fake();
    const first = await p.chargeSavedCard(charge('fakepm_ok_1'));
    const again = await p.chargeSavedCard(charge('fakepm_ok_1'));
    expect(first.status).toBe('succeeded');
    expect(again).toEqual(first);
  });

  it('test cards: 0002 always declines; 9995 declines its first charge only', async () => {
    const p = fake();
    expect((await p.chargeSavedCard(charge('fakepm_decline_1'))).status).toBe('declined');
    expect((await p.chargeSavedCard(charge('fakepm_declineonce_1', 'k1'))).status).toBe('declined');
    // The same key replays the decline; a new attempt (a new order) charges.
    expect((await p.chargeSavedCard(charge('fakepm_declineonce_1', 'k1'))).status).toBe('declined');
    expect((await p.chargeSavedCard(charge('fakepm_declineonce_1', 'k2'))).status).toBe('succeeded');
  });

  it('refuses a non-positive charge', async () => {
    await expect(
      fake().chargeSavedCard({ ...charge('fakepm_ok_1'), amount: { amount: 0, currency: 'USD' } }),
    ).rejects.toThrow();
  });
});

const SECRET = 'whsec_platform_0123456789abcdef';
function fakeStripe(routes: Record<string, StripeRoute>) {
  const api = fakeStripeApi(routes);
  const provider = stripePaymentProvider({
    secretKey: 'sk_test_fake',
    webhookSecrets: [SECRET],
    fetch: api.fetch,
    now: () => new Date('2027-05-01T12:00:00Z'),
  });
  return { provider, calls: api.calls };
}

describe('Stripe adapter — cards on file (M4.8e)', () => {
  it('creates the customer and a setup-mode Checkout Session on the connected account', async () => {
    const { provider, calls } = fakeStripe({
      'POST /v1/customers': () => ({ json: { id: 'cus_1', object: 'customer' } }),
      'POST /v1/checkout/sessions': () => ({
        json: { id: 'cs_setup_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/setup' },
      }),
    });
    const out = await provider.createCardSetup({
      orgId: ORG,
      reference: CARD,
      connectedAccountId: 'acct_org',
      email: 'ada@example.test',
      name: 'Ada',
      description: 'Gala',
      idempotencyKey: `card:${CARD}`,
      returnUrl: 'https://app.test/back',
    });
    expect(out).toEqual({
      providerSetupId: 'cs_setup_1',
      redirectUrl: 'https://checkout.stripe.com/c/setup',
    });
    const [cus, session] = calls;
    expect(cus?.account).toBe('acct_org');
    expect(session?.account).toBe('acct_org');
    expect(session?.body.get('mode')).toBe('setup');
    expect(session?.body.get('customer')).toBe('cus_1');
    expect(session?.body.get('metadata[reference]')).toBe(CARD);
    expect(session?.idempotencyKey).toBe(`card:${CARD}`);
  });

  it('charges off-session with confirm, exactly the amount, under the order key', async () => {
    const { provider, calls } = fakeStripe({
      'POST /v1/payment_intents': () => ({
        json: { id: 'pi_1', object: 'payment_intent', status: 'succeeded' },
      }),
    });
    const out = await provider.chargeSavedCard({ ...charge('pm_1'), connectedAccountId: 'acct_org' });
    expect(out).toEqual({ providerPaymentId: 'pi_1', status: 'succeeded' });
    const [c] = calls;
    expect(c?.body.get('amount')).toBe('100000');
    expect(c?.body.get('off_session')).toBe('true');
    expect(c?.body.get('confirm')).toBe('true');
    expect(c?.account).toBe('acct_org');
    expect(c?.idempotencyKey).toBe(`order:${ORDER}:1`);
  });

  it('a card error is a decline, not a throw', async () => {
    const { provider } = fakeStripe({
      'POST /v1/payment_intents': () => ({
        status: 402,
        json: {
          error: {
            type: 'card_error',
            code: 'card_declined',
            decline_code: 'insufficient_funds',
            message: 'Your card has insufficient funds.',
            payment_intent: { id: 'pi_2', object: 'payment_intent', status: 'requires_payment_method' },
          },
        },
      }),
    });
    const out = await provider.chargeSavedCard({ ...charge('pm_1'), connectedAccountId: 'acct_org' });
    expect(out).toEqual({ providerPaymentId: 'pi_2', status: 'declined', declineCode: 'insufficient_funds' });
  });

  it('a completed setup session becomes setup.succeeded with the card display details', async () => {
    const { provider } = fakeStripe({
      'GET /v1/setup_intents/seti_1': () => ({
        json: {
          id: 'seti_1',
          object: 'setup_intent',
          status: 'succeeded',
          customer: 'cus_1',
          payment_method: {
            id: 'pm_1',
            object: 'payment_method',
            card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
          },
        },
      }),
    });
    const { payload, headers } = await signStripeEvent(
      {
        id: 'evt_1',
        type: 'checkout.session.completed',
        account: 'acct_org',
        data: {
          object: {
            id: 'cs_setup_1',
            object: 'checkout.session',
            mode: 'setup',
            status: 'complete',
            setup_intent: 'seti_1',
            metadata: { orgId: ORG, reference: CARD, kind: 'card_setup' },
          },
        },
      },
      SECRET,
    );
    const e = await provider.verifyWebhook(payload, headers);
    expect(e).toEqual({
      provider: 'stripe',
      id: 'evt_1',
      type: 'setup.succeeded',
      orgId: ORG,
      reference: CARD,
      providerSetupId: 'cs_setup_1',
      customerId: 'cus_1',
      paymentMethodId: 'pm_1',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
  });
});
