import { z } from 'zod';

/**
 * The subscription billing provider (M6.6a, P6-7): Stripe Billing + Entitlements in production,
 * a fake in dev, preview and CI. Everything that talks to the provider goes through this port;
 * tests never call Stripe.
 */
export interface BillingProvider {
  readonly name: BillingProviderName;
  /** The provider's catalog: products (plans), prices and Entitlement Features (module keys). */
  listCatalog(): Promise<ProviderCatalog>;
  /** Create the org's customer (idempotent per key: a retry returns the same customer). */
  createCustomer(i: { orgId: string; idempotencyKey: string }): Promise<{ customerId: string }>;
  /** Verify a webhook on its raw body and normalize it; throws when the signature is wrong. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<BillingEvent>;
}

export const BILLING_PROVIDERS = ['fake', 'stripe'] as const;
export type BillingProviderName = (typeof BILLING_PROVIDERS)[number];

export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Statuses whose entitlements apply. Anything else (canceled, unpaid, paused, incomplete) falls
 * back to the org's plan modules; M6.6b turns a failed renewal into read-only (never data loss).
 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due'];

const base = {
  provider: z.enum(BILLING_PROVIDERS),
  /** The provider's event id (deduplication key). */
  id: z.string().min(1).max(255),
  /** When the provider created the event (ordering: an older event never overwrites a newer one). */
  createdAt: z.coerce.date(),
};

/** A subscription was created, changed or ended (`customer.subscription.*`). */
export const SubscriptionEvent = z.object({
  ...base,
  kind: z.literal('subscription'),
  type: z.string().min(1).max(100),
  customerId: z.string().min(1).max(255),
  subscriptionId: z.string().min(1).max(255),
  status: z.enum(SUBSCRIPTION_STATUSES),
  /** The subscribed price's lookup key (`tier_pro_month_usd`); maps the subscription to a plan. */
  priceLookupKey: z.string().max(100).nullable(),
  currentPeriodEnd: z.coerce.date().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type SubscriptionEvent = z.infer<typeof SubscriptionEvent>;

/**
 * The customer's active entitlements changed (`entitlements.active_entitlement_summary.updated`):
 * the full set of Entitlement Feature lookup keys, which are module keys.
 */
export const EntitlementsEvent = z.object({
  ...base,
  kind: z.literal('entitlements'),
  type: z.string().min(1).max(100),
  customerId: z.string().min(1).max(255),
  features: z.array(z.string().min(1).max(100)).max(500),
});
export type EntitlementsEvent = z.infer<typeof EntitlementsEvent>;

/** A product, price or feature changed: the worker's catalog sync picks it up. */
export interface CatalogEvent {
  readonly kind: 'catalog';
  readonly provider: BillingProviderName;
  readonly id: string;
  readonly type: string;
}

/** An event the platform does not act on (acknowledged so the provider stops retrying). */
export interface IgnoredBillingEvent {
  readonly kind: 'ignored';
  readonly provider: BillingProviderName;
  readonly id: string;
  readonly type: string;
}

export type BillingEvent = SubscriptionEvent | EntitlementsEvent | CatalogEvent | IgnoredBillingEvent;

/** An org-level event the webhook applies (after resolving the customer's org). */
export type OrgBillingEvent = SubscriptionEvent | EntitlementsEvent;

export interface CatalogProduct {
  readonly id: string;
  /** Our plan key (the product's `plan_key` metadata); null when the product is not a plan. */
  readonly planKey: string | null;
  readonly name: string;
  readonly active: boolean;
  /** Display order (the product's `sort_order` metadata). */
  readonly sortOrder: number;
  /** Lookup keys of the Entitlement Features attached to the product. */
  readonly features: readonly string[];
}

export interface CatalogPrice {
  readonly id: string;
  readonly productId: string;
  readonly lookupKey: string | null;
  readonly currency: string;
  readonly interval: 'month' | 'year' | null;
  /** Minor units; null for a custom (quoted) price. */
  readonly unitAmountMinor: number | null;
  readonly active: boolean;
}

export interface CatalogFeature {
  readonly id: string;
  readonly lookupKey: string;
  readonly active: boolean;
}

export interface ProviderCatalog {
  readonly products: readonly CatalogProduct[];
  readonly prices: readonly CatalogPrice[];
  readonly features: readonly CatalogFeature[];
}
