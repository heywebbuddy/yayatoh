import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { MODULE_KEYS } from '@yayatoh/platform';
import { z } from 'zod';
import { PLACEHOLDER_PLANS } from '../catalog.ts';
import {
  type BillingEvent,
  type BillingProvider,
  EntitlementsEvent,
  type ProviderCatalog,
  SubscriptionEvent,
} from './port.ts';

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

/**
 * Fake billing provider for dev, preview and CI (no Stripe account; never in production). Its
 * webhooks are HMAC-signed with a key derived from FAKE_PAYMENTS_SECRET, so the real webhook path
 * (raw-body verification, dedupe by event id, the apply command) runs end to end.
 */
export function fakeBillingProvider(opts: { secret: string }): BillingProvider {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The fake billing provider is not allowed in production');
  if (opts.secret.length < 32) throw new Error('fake provider secret must be ≥32 chars');
  return {
    name: 'fake',
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
