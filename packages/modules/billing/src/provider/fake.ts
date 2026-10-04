import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { MODULE_KEYS } from '@yayatoh/platform';
import { z } from 'zod';
import { PLACEHOLDER_PLANS } from '../catalog.ts';
import {
  type BillingEvent,
  type BillingProvider,
  type CouponId,
  EntitlementsEvent,
  type PlanChangeRequest,
  type ProviderCatalog,
  type ProviderChangePreview,
  SubscriptionEvent,
  type UsageReport,
} from './port.ts';
import { FAKE_TAX_BPS, NONPROFIT_COUPON, prorate } from './proration.ts';

export const FAKE_BILLING_SIGNATURE_HEADER = 'x-fake-billing-signature';

/** The fake's webhook key, derived from the shared fake secret (never the payments key itself). */
const webhookKey = (secret: string) => createHmac('sha256', secret).update('billing-webhook').digest();
const sign = (secret: string, body: string) =>
  createHmac('sha256', webhookKey(secret)).update(body).digest('hex');
const short = (secret: string, what: string, n = 20) =>
  createHmac('sha256', secret).update(what).digest('hex').slice(0, n);

/** The fake's catalog: the placeholder tiers, switched off, with every module key as a feature. */
export function fakeBillingCatalog(): ProviderCatalog {
  return {
    products: PLACEHOLDER_PLANS.map((p) => ({
      id: `fakeprod_${p.key}`,
      planKey: p.key,
      name: p.name,
      active: false,
      sortOrder: p.sortOrder,
      features: [...p.modules],
    })),
    prices: PLACEHOLDER_PLANS.flatMap((p) =>
      p.prices.map((x) => ({
        id: `fakeprice_${x.lookupKey}`,
        productId: `fakeprod_${p.key}`,
        lookupKey: x.lookupKey,
        currency: x.currency,
        interval: x.interval,
        unitAmountMinor: x.unitAmountMinor,
        active: false,
      })),
    ),
    features: MODULE_KEYS.map((k) => ({ id: `fakefeat_${k}`, lookupKey: k, active: true })),
  };
}

/** The fake customer id for an org (deterministic: linking twice reuses it). */
export const fakeCustomerId = (secret: string, orgId: string) =>
  `fakecus_${short(secret, `customer:${orgId}`)}`;

/** The fake subscription id of a customer (one subscription per customer, like the portal). */
export const fakeSubscriptionId = (secret: string, customerId: string) =>
  `fakesub_${short(secret, `subscription:${customerId}`)}`;

const FakeBody = z.discriminatedUnion('kind', [
  SubscriptionEvent,
  EntitlementsEvent,
  z.object({
    kind: z.literal('catalog'),
    provider: z.literal('fake'),
    id: z.string().min(1),
    type: z.string(),
  }),
]);

/** A signed fake webhook delivery (what the fake "sends" to our billing endpoint). */
export interface FakeBillingDelivery {
  readonly body: string;
  readonly headers: Record<string, string>;
}

export interface FakeBillingOptions {
  readonly secret: string;
  /**
   * Where the fake sends the webhooks a plan change or a payment causes (the real provider calls
   * our endpoint over the network; the fake hands them to this function). Unset: not sent.
   */
  readonly deliver?: (d: FakeBillingDelivery) => Promise<void>;
  /** Payments of open invoices fail (to drive dunning in tests). */
  readonly declinePayments?: boolean;
}

/** What the fake billing provider remembers (tests read it; dev shows nothing of it). */
export interface FakeBillingProvider extends BillingProvider {
  /** Meter events accepted, deduplicated by identifier like the provider's meter API. */
  readonly meterEvents: readonly UsageReport[];
  /** Coupons on subscriptions. */
  readonly discounts: ReadonlyMap<string, CouponId>;
}

const DAY = 86_400_000;

/**
 * Fake billing provider for dev, preview and CI (no Stripe account; never in production). Its
 * webhooks are HMAC-signed with a key derived from FAKE_PAYMENTS_SECRET, so the real webhook path
 * (raw-body verification, dedupe by event id, the apply command) runs end to end. Plan changes
 * and payments are answered at once and their webhooks handed to `deliver`; proration and tax
 * follow `prorate` (a flat 8 % stands in for Stripe Tax).
 */
export function fakeBillingProvider(opts: FakeBillingOptions): FakeBillingProvider {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The fake billing provider is not allowed in production');
  if (opts.secret.length < 32) throw new Error('fake provider secret must be ≥32 chars');
  const meterEvents: UsageReport[] = [];
  const seen = new Set<string>();
  const discounts = new Map<string, CouponId>();
  const priceOf = (lookupKey: string | null) => {
    const catalog = fakeBillingCatalog();
    const price = catalog.prices.find((p) => p.lookupKey === lookupKey);
    const product = price ? catalog.products.find((p) => p.id === price.productId) : undefined;
    return price && product ? { price, product } : null;
  };
  const preview = (i: PlanChangeRequest): ProviderChangePreview => {
    const target = priceOf(i.priceLookupKey);
    if (!target || target.price.unitAmountMinor === null || !target.price.interval)
      throw new Error(`fake billing: no fixed price ${i.priceLookupKey}`);
    const current = i.subscription ? priceOf(i.subscription.priceLookupKey) : null;
    const r = prorate({
      current:
        current && current.price.unitAmountMinor !== null && current.price.interval
          ? {
              unitAmountMinor: current.price.unitAmountMinor,
              interval: current.price.interval,
              currency: current.price.currency,
            }
          : null,
      target: {
        unitAmountMinor: target.price.unitAmountMinor,
        interval: target.price.interval,
        currency: target.price.currency,
      },
      periodEnd: i.subscription?.currentPeriodEnd ?? null,
      at: i.at,
      percentOff: i.coupon === 'nonprofit' ? NONPROFIT_COUPON.percentOff : 0,
      taxBps: FAKE_TAX_BPS,
    });
    return { ...r };
  };
  const send = async (events: Parameters<typeof signFakeBillingEvent>[1][]) => {
    if (!opts.deliver) return;
    for (const e of events) await opts.deliver(signFakeBillingEvent(opts.secret, e));
  };
  return {
    name: 'fake',
    meterEvents,
    discounts,
    async listCatalog() {
      return fakeBillingCatalog();
    },
    async createCustomer(i) {
      return { customerId: fakeCustomerId(opts.secret, i.orgId) };
    },
    async verifyWebhook(rawBody: string, headers: Headers): Promise<BillingEvent> {
      const a = Buffer.from(headers.get(FAKE_BILLING_SIGNATURE_HEADER) ?? '');
      const b = Buffer.from(sign(opts.secret, rawBody));
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid fake billing signature');
      const parsed = FakeBody.parse(JSON.parse(rawBody));
      if (parsed.provider !== 'fake') throw new Error('not a fake billing event');
      return parsed;
    },
    async previewPlanChange(i) {
      return preview(i);
    },
    async changePlan(i) {
      const p = preview(i);
      const target = priceOf(i.priceLookupKey);
      const subscriptionId = i.subscription?.id ?? fakeSubscriptionId(opts.secret, i.customerId);
      const createdAt = new Date();
      await send([
        {
          kind: 'subscription',
          type: i.subscription ? 'customer.subscription.updated' : 'customer.subscription.created',
          createdAt,
          customerId: i.customerId,
          subscriptionId,
          status: 'active',
          priceLookupKey: i.priceLookupKey,
          currentPeriodEnd: p.nextRenewalAt,
          cancelAtPeriodEnd: false,
        },
        {
          kind: 'entitlements',
          type: 'entitlements.active_entitlement_summary.updated',
          createdAt,
          customerId: i.customerId,
          features: [...(target?.product.features ?? [])],
        },
      ]);
      return { subscriptionId };
    },
    async payOutstanding(i) {
      if (opts.declinePayments) return { paid: false };
      const createdAt = new Date();
      const from = Math.max(i.subscription.currentPeriodEnd?.getTime() ?? 0, createdAt.getTime());
      await send([
        {
          kind: 'subscription',
          type: 'customer.subscription.updated',
          createdAt,
          customerId: i.customerId,
          subscriptionId: i.subscription.id,
          status: 'active',
          priceLookupKey: i.subscription.priceLookupKey,
          currentPeriodEnd: new Date(from + 30 * DAY),
          cancelAtPeriodEnd: false,
        },
      ]);
      return { paid: true };
    },
    async reportUsage(r) {
      if (seen.has(r.identifier)) return;
      seen.add(r.identifier);
      meterEvents.push({ ...r });
    },
    async setDiscount(i) {
      if (i.coupon) discounts.set(i.subscriptionId, i.coupon);
      else discounts.delete(i.subscriptionId);
    },
  };
}

type Unsigned<E> = E extends { id: string; provider: unknown; createdAt: unknown }
  ? Omit<E, 'id' | 'provider' | 'createdAt'> & { id?: string; createdAt?: Date }
  : never;

/** Build and sign a fake billing webhook (the fake billing portal, dev tools and tests). */
export function signFakeBillingEvent(
  secret: string,
  e: Unsigned<SubscriptionEvent> | Unsigned<EntitlementsEvent>,
): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify({
    ...e,
    id: e.id ?? `fakeevt_${randomUUID()}`,
    createdAt: (e.createdAt ?? new Date()).toISOString(),
    provider: 'fake',
  });
  return {
    body,
    headers: { 'content-type': 'application/json', [FAKE_BILLING_SIGNATURE_HEADER]: sign(secret, body) },
  };
}

/**
 * The fake billing portal's link signature (dev only): the portal page acts on the customer only
 * when the link was minted by the plan page for that customer and return path.
 */
export function fakePortalSignature(secret: string, customerId: string, returnPath: string): string {
  return short(secret, `portal:${customerId}:${returnPath}`, 32);
}
