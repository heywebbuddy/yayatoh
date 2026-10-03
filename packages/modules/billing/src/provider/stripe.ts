import Stripe from 'stripe';
import {
  type BillingEvent,
  type BillingProvider,
  type CatalogFeature,
  type CatalogPrice,
  type CatalogProduct,
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from './port.ts';

/** The Stripe API version this adapter is written against (the payments adapter's, pinned). */
export const STRIPE_BILLING_API_VERSION = '2026-08-26.dahlia' as const;

export interface StripeBillingOptions {
  /** `sk_test_…` / `rk_test_…` (live keys only in production — enforced below). */
  readonly secretKey: string;
  /** The billing webhook endpoint's signing secret (`whsec_…`). */
  readonly webhookSecret: string;
  /** Tests only: a fake `fetch` that records requests and answers them (no network). */
  readonly fetch?: typeof fetch;
}

const CATALOG_EVENT = /^(product|price|entitlements\.feature)\./;
const SUBSCRIPTION_EVENT = /^customer\.subscription\.(created|updated|deleted|paused|resumed)$/;

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : (v?.id ?? null));
const secondsToDate = (s: number | null | undefined) => (typeof s === 'number' ? new Date(s * 1000) : null);

/**
 * Stripe Billing + Entitlements behind the `BillingProvider` port (M6.6a, P6-7), dormant until the
 * owner has the account and switches billing on. Products carry our plan key in `metadata.plan_key`,
 * prices a lookup key (`tier_pro_month_usd`), and Entitlement Features a lookup key equal to a module
 * key, so a plan change reaches the org's modules through the
 * `entitlements.active_entitlement_summary.updated` webhook alone. Tests drive it over a fake
 * `fetch` with the object shapes of Stripe test mode; nothing here is ever called from CI.
 */
export function stripeBillingProvider(opts: StripeBillingOptions): BillingProvider {
  const live = opts.secretKey.startsWith('sk_live_') || opts.secretKey.startsWith('rk_live_');
  if (live && process.env.VERCEL_ENV !== 'production')
    throw new Error('Live Stripe keys are only allowed in production');
  if (!opts.webhookSecret) throw new Error('The Stripe billing webhook secret is required');
  const stripe = new Stripe(opts.secretKey, {
    apiVersion: STRIPE_BILLING_API_VERSION,
    maxNetworkRetries: 2,
    telemetry: false,
    timeout: 20_000,
    appInfo: { name: 'Yayatoh' },
    ...(opts.fetch ? { httpClient: Stripe.createFetchHttpClient(opts.fetch) } : {}),
  });

  /** Every active entitlement of a customer (when the summary in the event was truncated). */
  async function allEntitlements(customer: string): Promise<string[]> {
    const out: string[] = [];
    for await (const e of stripe.entitlements.activeEntitlements.list({ customer, limit: 100 }))
      out.push(e.lookup_key);
    return out;
  }

  return {
    name: 'stripe',

    async listCatalog() {
      const products: CatalogProduct[] = [];
      for await (const p of stripe.products.list({ limit: 100 })) {
        const features: string[] = [];
        for await (const f of stripe.products.listFeatures(p.id, { limit: 100 }))
          if (f.entitlement_feature.active) features.push(f.entitlement_feature.lookup_key);
        const sort = Number.parseInt(p.metadata?.sort_order ?? '', 10);
        products.push({
          id: p.id,
          planKey: p.metadata?.plan_key?.trim() || null,
          name: p.name,
          active: p.active,
          sortOrder: Number.isInteger(sort) ? sort : 0,
          features,
        });
      }
      const prices: CatalogPrice[] = [];
      for await (const x of stripe.prices.list({ limit: 100 })) {
        const interval: string | undefined = x.recurring?.interval;
        prices.push({
          id: x.id,
          productId: idOf(x.product) ?? '',
          lookupKey: x.lookup_key ?? null,
          currency: x.currency.toUpperCase(),
          interval: interval === 'month' || interval === 'year' ? interval : null,
          unitAmountMinor: x.custom_unit_amount ? null : (x.unit_amount ?? null),
          active: x.active,
        });
      }
      const features: CatalogFeature[] = [];
      for await (const f of stripe.entitlements.features.list({ limit: 100 }))
        features.push({ id: f.id, lookupKey: f.lookup_key, active: f.active });
      return { products, prices, features };
    },

    async createCustomer(i) {
      const c = await stripe.customers.create(
        { metadata: { org_id: i.orgId } },
        { idempotencyKey: i.idempotencyKey },
      );
      return { customerId: c.id };
    },

    async verifyWebhook(rawBody: string, headers: Headers): Promise<BillingEvent> {
      const event = await stripe.webhooks.constructEventAsync(
        rawBody,
        headers.get('stripe-signature') ?? '',
        opts.webhookSecret,
      );
      const createdAt = new Date(event.created * 1000);
      if (event.type === 'entitlements.active_entitlement_summary.updated') {
        const summary = event.data.object;
        const features = summary.entitlements.has_more
          ? await allEntitlements(summary.customer)
          : summary.entitlements.data.map((e) => e.lookup_key);
        return {
          kind: 'entitlements',
          provider: 'stripe',
          id: event.id,
          type: event.type,
          createdAt,
          customerId: summary.customer,
          features,
        };
      }
      if (SUBSCRIPTION_EVENT.test(event.type)) {
        const sub = event.data.object as Stripe.Subscription;
        const item = sub.items?.data?.[0];
        const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status)
          ? (sub.status as SubscriptionStatus)
          : 'incomplete';
        return {
          kind: 'subscription',
          provider: 'stripe',
          id: event.id,
          type: event.type,
          createdAt,
          customerId: idOf(sub.customer) ?? '',
          subscriptionId: sub.id,
          status,
          priceLookupKey: item?.price?.lookup_key ?? null,
          currentPeriodEnd: secondsToDate(item?.current_period_end),
          cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        };
      }
      if (CATALOG_EVENT.test(event.type))
        return { kind: 'catalog', provider: 'stripe', id: event.id, type: event.type };
      return { kind: 'ignored', provider: 'stripe', id: event.id, type: event.type };
    },
  };
}
