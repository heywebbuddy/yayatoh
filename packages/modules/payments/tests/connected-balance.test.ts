import { describe, expect, it } from 'vitest';
import {
  fakePaymentProvider,
  fakePayouts,
  fakeProcessingFee,
  memoryBalanceStore,
  signFakeWebhook,
  stripePaymentProvider,
} from '../src/index.ts';
import { fakeStripeApi } from '../src/testing.ts';

/**
 * M4.8g: the organizer's connected account as the provider sees it — direct charges (gross, fee,
 * net), refunds, and the daily payouts that pay them out — for donations reconciliation.
 */
const secret = 'x'.repeat(40);
const ACCT = 'fakeacct_charity';

describe('fake provider — connected account balance and payouts (M4.8g)', () => {
  it('records direct charges with the nonprofit fee, refunds, and saved-card charges on the account', async () => {
    let clock = new Date('2027-05-01T20:00:00Z');
    const store = memoryBalanceStore();
    const fake = fakePaymentProvider({ secret, appOrigin: 'http://x', store, now: () => clock });
    const hook = signFakeWebhook(secret, {
      type: 'payment.succeeded',
      providerPaymentId: 'fakepi_1',
      amountMinor: 100_000,
      currency: 'USD',
      orgId: 'o1',
      orderId: 'ord1',
      applicationFeeMinor: 0,
      connectedAccountId: ACCT,
    });
    const ev = await fake.verifyWebhook(hook.body, new Headers({ 'x-fake-signature': hook.signature }));
    // The connected account is not part of the event the app sees.
    expect(ev).not.toHaveProperty('connectedAccountId');
    await fake.refund({
      providerPaymentId: 'fakepi_1',
      amount: { amount: 2_500, currency: 'USD' },
      connectedAccountId: ACCT,
      refundApplicationFee: { amount: 0, currency: 'USD' },
      idempotencyKey: 'refund:r1',
      orgId: 'o1',
    });
    const charge = {
      orgId: 'o1',
      orderId: 'ord2',
      amount: { amount: 25_000, currency: 'USD' },
      connectedAccountId: ACCT,
      customerId: 'fakecus_1',
      paymentMethodId: 'fakepm_ok_1',
      description: 'Pledge',
      idempotencyKey: 'order:ord2:1',
    };
    await fake.chargeSavedCard(charge);
    // A replayed charge answers the same and moves nothing again.
    await fake.chargeSavedCard(charge);
    // A declined card moves nothing.
    await fake.chargeSavedCard({
      ...charge,
      orderId: 'ord3',
      paymentMethodId: 'fakepm_decline_1',
      idempotencyKey: 'k3',
    });

    const window = { connectedAccountId: ACCT, from: new Date('2027-05-01'), to: new Date('2027-05-02') };
    const listed = await fake.listConnectedBalanceTransactions(window);
    expect(
      listed?.map((t) => [t.kind, t.amountMinor, t.feeMinor, t.netMinor, t.reference, t.payoutId]),
    ).toEqual([
      ['charge', 100_000, 2_230, 97_770, 'order:ord1', null],
      ['refund', -2_500, 0, -2_500, 'refund:r1', null],
      ['charge', 25_000, 580, 24_420, 'order:ord2', null],
    ]);
    // The platform balance only saw the (zero) application fee: nothing.
    expect(await fake.listBalanceTransactions({ from: window.from, to: window.to })).toEqual([]);
    // No payout until the next day; then one for the day's net, paid two days later.
    expect(await fake.listPayouts(window)).toEqual([]);
    clock = new Date('2027-05-02T01:00:00Z');
    const next = { ...window, to: new Date('2027-05-09') };
    const [payout, ...rest] = (await fake.listPayouts(next)) ?? [];
    expect(rest).toEqual([]);
    expect(payout).toMatchObject({
      amountMinor: 97_770 - 2_500 + 24_420,
      currency: 'USD',
      status: 'in_transit',
      arrivalDate: '2027-05-04',
    });
    const paidOut = await fake.listConnectedBalanceTransactions(window);
    expect(paidOut?.every((t) => t.payoutId === payout?.id)).toBe(true);
    clock = new Date('2027-05-04T00:00:00Z');
    expect((await fake.listPayouts(next))?.[0]?.status).toBe('paid');
    // Another account sees nothing; a fake without a store cannot list.
    expect(
      await fake.listConnectedBalanceTransactions({ ...window, connectedAccountId: 'fakeacct_other' }),
    ).toEqual([]);
    const bare = fakePaymentProvider({ secret, appOrigin: 'http://x' });
    expect(await bare.listConnectedBalanceTransactions(window)).toBeNull();
    expect(await bare.listPayouts(window)).toBeNull();
  });

  it('the fee is 2.2% + 30¢ rounded half up; a day with no positive net has no payout', () => {
    expect(fakeProcessingFee(10_000)).toBe(250);
    expect(fakeProcessingFee(1_025)).toBe(53);
    expect(fakeProcessingFee(-500)).toBe(0);
    const at = new Date('2027-05-01T10:00:00Z');
    const { payouts, payoutOf } = fakePayouts(
      'a',
      [
        {
          id: 't',
          kind: 'refund',
          amountMinor: -500,
          feeMinor: 0,
          netMinor: -500,
          currency: 'USD',
          occurredAt: at,
          reference: null,
        },
      ],
      new Date('2027-06-01'),
      (k) => k,
    );
    expect(payouts).toEqual([]);
    expect(payoutOf.size).toBe(0);
  });
});

describe('Stripe adapter — connected balance and payouts (M4.8g)', () => {
  it('lists the account’s movements with fees, attributes charges and refunds, and finds each payout', async () => {
    const ORG = '0199a1b2-0000-7000-8000-000000000001';
    const api = fakeStripeApi({
      'GET /v1/balance_transactions': (c) =>
        c.query.get('payout') === 'po_1'
          ? {
              json: {
                object: 'list',
                data: [{ id: 'txn_ch', object: 'balance_transaction' }],
                has_more: false,
              },
            }
          : {
              json: {
                object: 'list',
                has_more: false,
                data: [
                  {
                    id: 'txn_ch',
                    object: 'balance_transaction',
                    type: 'charge',
                    amount: 10_000,
                    fee: 250,
                    net: 9_750,
                    currency: 'usd',
                    created: 1_809_000_000,
                    source: {
                      id: 'ch_1',
                      object: 'charge',
                      metadata: { orgId: ORG, orderId: 'ord1', fundsFlow: 'organizer_mor' },
                    },
                  },
                  {
                    id: 'txn_re',
                    object: 'balance_transaction',
                    type: 'refund',
                    amount: -1_000,
                    fee: 0,
                    net: -1_000,
                    currency: 'usd',
                    created: 1_809_000_100,
                    source: {
                      id: 're_1',
                      object: 'refund',
                      metadata: { orgId: ORG, yayatoh_ref: 'refund:r1' },
                    },
                  },
                  {
                    id: 'txn_po',
                    object: 'balance_transaction',
                    type: 'payout',
                    amount: -8_750,
                    fee: 0,
                    net: -8_750,
                    currency: 'usd',
                    created: 1_809_100_000,
                    source: { id: 'po_1', object: 'payout' },
                  },
                ],
              },
            },
      'GET /v1/payouts': () => ({
        json: {
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'po_1',
              object: 'payout',
              amount: 8_750,
              currency: 'usd',
              status: 'paid',
              created: 1_809_090_000,
              arrival_date: 1_809_216_000,
            },
          ],
        },
      }),
    });
    const provider = stripePaymentProvider({
      secretKey: 'sk_test_fake',
      webhookSecrets: ['whsec_x'],
      fetch: api.fetch,
    });
    const window = {
      connectedAccountId: 'acct_charity',
      from: new Date(1_808_900_000_000),
      to: new Date(1_809_200_000_000),
    };
    const out = await provider.listConnectedBalanceTransactions(window);
    expect(
      out?.map((t) => [t.kind, t.amountMinor, t.feeMinor, t.netMinor, t.currency, t.reference, t.payoutId]),
    ).toEqual([
      ['charge', 10_000, 250, 9_750, 'USD', 'order:ord1', 'po_1'],
      ['refund', -1_000, 0, -1_000, 'USD', 'refund:r1', null],
      ['payout', -8_750, 0, -8_750, 'USD', null, null],
    ]);
    // Every call is made on the connected account.
    expect(api.calls.every((c) => c.account === 'acct_charity')).toBe(true);
    expect(api.calls.find((c) => c.query.get('payout') === 'po_1')).toBeTruthy();
    const payouts = await provider.listPayouts(window);
    expect(payouts).toEqual([
      {
        id: 'po_1',
        amountMinor: 8_750,
        currency: 'USD',
        status: 'paid',
        createdAt: new Date(1_809_090_000_000),
        arrivalDate: new Date(1_809_216_000_000).toISOString().slice(0, 10),
      },
    ]);
  });
});
