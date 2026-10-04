import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { STRIPE_BILLING_API_VERSION, stripeBillingProvider } from '../src/index.ts';

/*
 * The Stripe billing adapter over a fake Stripe API (no network, no keys): the objects below are
 * shaped like Stripe test mode's (API 2026-08-26.dahlia), and webhooks are signed exactly as
 * Stripe signs them. Nothing here ever reaches Stripe.
 */

const WHSEC = 'whsec_billing_0123456789abcdef';

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: URLSearchParams;
  idempotencyKey: string | null;
}
type Route = (c: Call) => { status?: number; json: unknown };

function fakeStripeApi(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
      idempotencyKey: headers.get('idempotency-key'),
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    const out = route ? route(call) : { status: 404, json: { error: { type: 'invalid_request_error' } } };
    return new Response(JSON.stringify(out.json), {
      status: out.status ?? 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
    });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const list = (data: unknown[], has_more = false) => ({ object: 'list', data, has_more, url: '/v1/x' });

function adapter(routes: Record<string, Route> = {}) {
  const api = fakeStripeApi(routes);
  return {
    provider: stripeBillingProvider({ secretKey: 'sk_test_fake', webhookSecret: WHSEC, fetch: api.fetch }),
    calls: api.calls,
  };
}

const signer = new Stripe('sk_test_signer', { apiVersion: STRIPE_BILLING_API_VERSION });
async function signed(event: Record<string, unknown>, secret = WHSEC) {
  const payload = JSON.stringify({
    object: 'event',
    api_version: STRIPE_BILLING_API_VERSION,
    livemode: false,
    created: 1_790_000_000,
    ...event,
  });
  const header = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return { payload, headers: new Headers({ 'stripe-signature': header }) };
}

const subscriptionObject = (over: Record<string, unknown> = {}) => ({
  id: 'sub_test_1',
  object: 'subscription',
  customer: 'cus_test_1',
  status: 'active',
  cancel_at_period_end: false,
  items: {
    object: 'list',
    data: [
      {
        id: 'si_test_1',
        object: 'subscription_item',
        current_period_end: 1_792_000_000,
        price: {
          id: 'price_test_pro_month',
          object: 'price',
          lookup_key: 'tier_pro_month_usd',
          product: 'prod_test_pro',
          currency: 'usd',
          unit_amount: 9900,
          recurring: { interval: 'month', interval_count: 1 },
        },
      },
    ],
  },
  metadata: { org_id: 'irrelevant' },
  ...over,
});

const entitlement = (lookup: string) => ({
  id: `ent_test_${lookup}`,
  object: 'entitlements.active_entitlement',
  feature: `feat_test_${lookup}`,
  livemode: false,
  lookup_key: lookup,
});

describe('Stripe billing adapter — webhooks (M6.6a)', () => {
  it('maps customer.subscription.updated to a subscription event (price lookup key → plan)', async () => {
    const { provider } = adapter();
    const { payload, headers } = await signed({
      id: 'evt_sub_1',
      type: 'customer.subscription.updated',
      data: { object: subscriptionObject() },
    });
    expect(await provider.verifyWebhook(payload, headers)).toEqual({
      kind: 'subscription',
      provider: 'stripe',
      id: 'evt_sub_1',
      type: 'customer.subscription.updated',
      createdAt: new Date(1_790_000_000 * 1000),
      customerId: 'cus_test_1',
      subscriptionId: 'sub_test_1',
      status: 'active',
      priceLookupKey: 'tier_pro_month_usd',
      currentPeriodEnd: new Date(1_792_000_000 * 1000),
      cancelAtPeriodEnd: false,
    });
  });

  it('maps customer.subscription.deleted (canceled) and an expanded customer', async () => {
    const { provider } = adapter();
    const { payload, headers } = await signed({
      id: 'evt_sub_2',
      type: 'customer.subscription.deleted',
      data: {
        object: subscriptionObject({
          status: 'canceled',
          customer: { id: 'cus_test_9', object: 'customer' },
        }),
      },
    });
    expect(await provider.verifyWebhook(payload, headers)).toMatchObject({
      kind: 'subscription',
      status: 'canceled',
      customerId: 'cus_test_9',
    });
  });

  it('maps the active entitlement summary to the full set of feature lookup keys', async () => {
    const { provider, calls } = adapter();
    const { payload, headers } = await signed({
      id: 'evt_ent_1',
      type: 'entitlements.active_entitlement_summary.updated',
      data: {
        object: {
          object: 'entitlements.active_entitlement_summary',
          customer: 'cus_test_1',
          livemode: false,
          entitlements: list([entitlement('core'), entitlement('sessions')]),
        },
      },
    });
    expect(await provider.verifyWebhook(payload, headers)).toEqual({
      kind: 'entitlements',
      provider: 'stripe',
      id: 'evt_ent_1',
      type: 'entitlements.active_entitlement_summary.updated',
      createdAt: new Date(1_790_000_000 * 1000),
      customerId: 'cus_test_1',
      features: ['core', 'sessions'],
    });
    expect(calls).toHaveLength(0);
  });

  it('lists every active entitlement when the summary in the event is truncated', async () => {
    const { provider, calls } = adapter({
      'GET /v1/entitlements/active_entitlements': (c) =>
        c.query.get('starting_after')
          ? { json: list([entitlement('speakers')]) }
          : { json: list([entitlement('core'), entitlement('sessions')], true) },
    });
    const { payload, headers } = await signed({
      id: 'evt_ent_2',
      type: 'entitlements.active_entitlement_summary.updated',
      data: {
        object: {
          object: 'entitlements.active_entitlement_summary',
          customer: 'cus_test_1',
          livemode: false,
          entitlements: list([entitlement('core')], true),
        },
      },
    });
    const e = await provider.verifyWebhook(payload, headers);
    expect(e).toMatchObject({ kind: 'entitlements', features: ['core', 'sessions', 'speakers'] });
    expect(calls.map((c) => c.query.get('customer'))).toEqual(['cus_test_1', 'cus_test_1']);
  });

  it('acknowledges catalog changes and ignores everything else', async () => {
    const { provider } = adapter();
    for (const type of ['product.updated', 'price.created', 'entitlements.feature.updated']) {
      const { payload, headers } = await signed({ id: `evt_${type}`, type, data: { object: {} } });
      expect(await provider.verifyWebhook(payload, headers)).toEqual({
        kind: 'catalog',
        provider: 'stripe',
        id: `evt_${type}`,
        type,
      });
    }
    const { payload, headers } = await signed({ id: 'evt_x', type: 'invoice.paid', data: { object: {} } });
    expect(await provider.verifyWebhook(payload, headers)).toMatchObject({
      kind: 'ignored',
      type: 'invoice.paid',
    });
  });

  it('refuses a wrong secret, a tampered body and a missing header', async () => {
    const { provider } = adapter();
    const good = await signed({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    const wrong = await signed(
      { id: 'evt_1', type: 'invoice.paid', data: { object: {} } },
      'whsec_other_000000000000',
    );
    await expect(provider.verifyWebhook(wrong.payload, wrong.headers)).rejects.toThrow();
    await expect(
      provider.verifyWebhook(good.payload.replace('evt_1', 'evt_2'), good.headers),
    ).rejects.toThrow();
    await expect(provider.verifyWebhook(good.payload, new Headers())).rejects.toThrow();
  });
});

describe('Stripe billing adapter — catalog and customers (M6.6a)', () => {
  it('lists products (plan_key metadata, attached features), prices and features, across pages', async () => {
    const { provider } = adapter({
      'GET /v1/products': (c) =>
        c.query.get('starting_after')
          ? {
              json: list([
                { id: 'prod_other', object: 'product', name: 'Gift card', active: true, metadata: {} },
              ]),
            }
          : {
              json: list(
                [
                  {
                    id: 'prod_test_pro',
                    object: 'product',
                    name: 'Pro',
                    active: false,
                    metadata: { plan_key: 'tier_pro', sort_order: '3' },
                  },
                ],
                true,
              ),
            },
      'GET /v1/products/prod_test_pro/features': () => ({
        json: list([
          {
            id: 'prodft_1',
            object: 'product_feature',
            entitlement_feature: {
              id: 'feat_1',
              object: 'entitlements.feature',
              lookup_key: 'sessions',
              active: true,
            },
          },
          {
            id: 'prodft_2',
            object: 'product_feature',
            entitlement_feature: {
              id: 'feat_2',
              object: 'entitlements.feature',
              lookup_key: 'old',
              active: false,
            },
          },
        ]),
      }),
      'GET /v1/products/prod_other/features': () => ({ json: list([]) }),
      'GET /v1/prices': () => ({
        json: list([
          {
            id: 'price_test_pro_month',
            object: 'price',
            product: 'prod_test_pro',
            lookup_key: 'tier_pro_month_usd',
            currency: 'usd',
            unit_amount: 9900,
            active: false,
            recurring: { interval: 'month' },
          },
          {
            id: 'price_test_ent',
            object: 'price',
            product: 'prod_test_ent',
            lookup_key: 'tier_enterprise_year_usd',
            currency: 'usd',
            unit_amount: null,
            custom_unit_amount: { minimum: null, maximum: null, preset: null },
            active: true,
            recurring: { interval: 'year' },
          },
          {
            id: 'price_gift',
            object: 'price',
            product: 'prod_other',
            lookup_key: null,
            currency: 'usd',
            unit_amount: 500,
            active: true,
            recurring: null,
          },
        ]),
      }),
      'GET /v1/entitlements/features': () => ({
        json: list([{ id: 'feat_1', object: 'entitlements.feature', lookup_key: 'sessions', active: true }]),
      }),
    });
    const c = await provider.listCatalog();
    expect(c.products).toEqual([
      {
        id: 'prod_test_pro',
        planKey: 'tier_pro',
        name: 'Pro',
        active: false,
        sortOrder: 3,
        features: ['sessions'],
      },
      { id: 'prod_other', planKey: null, name: 'Gift card', active: true, sortOrder: 0, features: [] },
    ]);
    expect(c.prices).toEqual([
      {
        id: 'price_test_pro_month',
        productId: 'prod_test_pro',
        lookupKey: 'tier_pro_month_usd',
        currency: 'USD',
        interval: 'month',
        unitAmountMinor: 9900,
        active: false,
      },
      {
        id: 'price_test_ent',
        productId: 'prod_test_ent',
        lookupKey: 'tier_enterprise_year_usd',
        currency: 'USD',
        interval: 'year',
        unitAmountMinor: null,
        active: true,
      },
      {
        id: 'price_gift',
        productId: 'prod_other',
        lookupKey: null,
        currency: 'USD',
        interval: null,
        unitAmountMinor: 500,
        active: true,
      },
    ]);
    expect(c.features).toEqual([{ id: 'feat_1', lookupKey: 'sessions', active: true }]);
  });

  it('creates the customer with the org in metadata and the idempotency key', async () => {
    const { provider, calls } = adapter({
      'POST /v1/customers': () => ({ json: { id: 'cus_test_new', object: 'customer' } }),
    });
    expect(
      await provider.createCustomer({ orgId: 'org-1', idempotencyKey: 'billing-customer:org-1' }),
    ).toEqual({
      customerId: 'cus_test_new',
    });
    expect(calls[0]?.body.get('metadata[org_id]')).toBe('org-1');
    expect(calls[0]?.idempotencyKey).toBe('billing-customer:org-1');
  });

  it('refuses live keys outside production and needs a webhook secret', () => {
    expect(() => stripeBillingProvider({ secretKey: 'sk_live_x', webhookSecret: WHSEC })).toThrow(
      'Live Stripe keys are only allowed in production',
    );
    expect(() => stripeBillingProvider({ secretKey: 'sk_test_x', webhookSecret: '' })).toThrow();
  });
});

describe('Stripe billing adapter — plan changes, payments, meters, coupons (M6.6b)', () => {
  const priceList = () => ({
    json: list([
      {
        id: 'price_test_starter_month',
        object: 'price',
        lookup_key: 'tier_starter_month_usd',
        currency: 'usd',
        unit_amount: 2900,
        active: true,
        product: 'prod_test_starter',
        recurring: { interval: 'month' },
      },
    ]),
  });
  const invoice = (over: Record<string, unknown> = {}) => ({
    id: 'in_test_1',
    object: 'invoice',
    currency: 'usd',
    amount_due: 3780,
    total: 3780,
    status: 'draft',
    lines: list([
      { id: 'il_1', object: 'line_item', amount: -4950 },
      { id: 'il_2', object: 'line_item', amount: 8450 },
    ]),
    total_discount_amounts: [],
    total_taxes: [{ amount: 280, tax_behavior: 'exclusive', taxable_amount: 3500 }],
    ...over,
  });
  const current = {
    id: 'sub_test_1',
    priceLookupKey: 'tier_pro_month_usd',
    currentPeriodEnd: new Date(1_792_000_000_000),
  };

  it('previews a change with the invoice preview: proration date, automatic tax, the item swapped', async () => {
    const { provider, calls } = adapter({
      'GET /v1/prices': priceList,
      'GET /v1/subscriptions/sub_test_1': () => ({ json: subscriptionObject() }),
      'POST /v1/invoices/create_preview': () => ({ json: invoice() }),
    });
    const at = new Date(1_791_000_000_000);
    const p = await provider.previewPlanChange({
      customerId: 'cus_test_1',
      subscription: current,
      priceLookupKey: 'tier_starter_month_usd',
      at,
      coupon: null,
    });
    expect(p).toEqual({
      currency: 'USD',
      creditMinor: 4950,
      chargeMinor: 8450,
      discountMinor: 0,
      taxMinor: 280,
      amountDueMinor: 3780,
      creditBalanceMinor: 0,
      nextRenewalMinor: 2900,
      nextRenewalAt: current.currentPeriodEnd,
    });
    const preview = calls.find((c) => c.path === '/v1/invoices/create_preview');
    expect(preview?.body.get('subscription')).toBe('sub_test_1');
    expect(preview?.body.get('automatic_tax[enabled]')).toBe('true');
    expect(preview?.body.get('subscription_details[items][0][id]')).toBe('si_test_1');
    expect(preview?.body.get('subscription_details[items][0][price]')).toBe('price_test_starter_month');
    expect(preview?.body.get('subscription_details[proration_date]')).toBe(String(at.getTime() / 1000));
    expect(calls.find((c) => c.path === '/v1/prices')?.query.get('lookup_keys[0]')).toBe(
      'tier_starter_month_usd',
    );
  });

  it('changes the subscription with prorations and the idempotency key; starts one with the coupon', async () => {
    const { provider, calls } = adapter({
      'GET /v1/prices': priceList,
      'GET /v1/subscriptions/sub_test_1': () => ({ json: subscriptionObject() }),
      'POST /v1/subscriptions/sub_test_1': () => ({ json: subscriptionObject() }),
      'POST /v1/subscriptions': () => ({ json: subscriptionObject({ id: 'sub_test_new' }) }),
    });
    const at = new Date(1_791_000_000_000);
    const changed = await provider.changePlan({
      customerId: 'cus_test_1',
      subscription: current,
      priceLookupKey: 'tier_starter_month_usd',
      at,
      coupon: null,
      idempotencyKey: 'billing-plan-change:1',
    });
    expect(changed).toEqual({ subscriptionId: 'sub_test_1' });
    const update = calls.find((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_test_1');
    expect(update?.idempotencyKey).toBe('billing-plan-change:1');
    expect(update?.body.get('proration_behavior')).toBe('always_invoice');
    expect(update?.body.get('items[0][id]')).toBe('si_test_1');
    expect(update?.body.get('automatic_tax[enabled]')).toBe('true');
    const started = await provider.changePlan({
      customerId: 'cus_test_1',
      subscription: null,
      priceLookupKey: 'tier_starter_month_usd',
      at,
      coupon: 'nonprofit',
      idempotencyKey: 'billing-plan-change:2',
    });
    expect(started).toEqual({ subscriptionId: 'sub_test_new' });
    const create = calls.find((c) => c.method === 'POST' && c.path === '/v1/subscriptions');
    expect(create?.idempotencyKey).toBe('billing-plan-change:2');
    expect(create?.body.get('discounts[0][coupon]')).toBe('nonprofit');
    expect(create?.body.get('customer')).toBe('cus_test_1');
  });

  it('pays the open invoice (idempotent); nothing open counts as paid', async () => {
    let open = true;
    const { provider, calls } = adapter({
      'GET /v1/invoices': () => ({ json: list(open ? [invoice({ status: 'open' })] : []) }),
      'POST /v1/invoices/in_test_1/pay': () => ({ json: invoice({ status: 'paid' }) }),
    });
    const i = { customerId: 'cus_test_1', subscription: current, idempotencyKey: 'billing-pay:k1' };
    expect(await provider.payOutstanding(i)).toEqual({ paid: true });
    expect(calls.find((c) => c.path === '/v1/invoices/in_test_1/pay')?.idempotencyKey).toBe('billing-pay:k1');
    expect(calls.find((c) => c.path === '/v1/invoices')?.query.get('status')).toBe('open');
    open = false;
    expect(await provider.payOutstanding(i)).toEqual({ paid: true });
  });

  it('reports usage as meter events with our record id as the identifier', async () => {
    const { provider, calls } = adapter({
      'POST /v1/billing/meter_events': () => ({
        json: { object: 'billing.meter_event', event_name: 'yayatoh_sms' },
      }),
    });
    await provider.reportUsage({
      customerId: 'cus_test_1',
      meter: 'sms',
      quantity: 3,
      identifier: '0199a0a0-0000-7000-8000-000000000001',
      timestamp: new Date(1_791_000_000_000),
    });
    const c = calls[0];
    expect(c?.body.get('event_name')).toBe('yayatoh_sms');
    expect(c?.body.get('payload[stripe_customer_id]')).toBe('cus_test_1');
    expect(c?.body.get('payload[value]')).toBe('3');
    expect(c?.body.get('identifier')).toBe('0199a0a0-0000-7000-8000-000000000001');
    expect(c?.body.get('timestamp')).toBe('1791000000');
  });

  it('puts the nonprofit coupon on the subscription and takes it off', async () => {
    const { provider, calls } = adapter({
      'POST /v1/subscriptions/sub_test_1': () => ({ json: subscriptionObject() }),
    });
    await provider.setDiscount({ subscriptionId: 'sub_test_1', coupon: 'nonprofit', idempotencyKey: 'd1' });
    await provider.setDiscount({ subscriptionId: 'sub_test_1', coupon: null, idempotencyKey: 'd2' });
    expect(calls[0]?.body.get('discounts[0][coupon]')).toBe('nonprofit');
    expect(calls[0]?.idempotencyKey).toBe('d1');
    expect(calls[1]?.body.get('discounts')).toBe('');
  });
});
