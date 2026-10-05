import { isModuleKey } from '@yayatoh/platform';
import { PLAN_KEY_PATTERN } from './catalog.ts';
import { DEFAULT_PLAN } from './entitlements.ts';
import type { ProviderCatalog } from './provider/port.ts';

const LOOKUP_KEY = /^[a-z0-9][a-z0-9_]{2,80}$/;

export interface CatalogSyncPayload {
  readonly plans: readonly {
    key: string;
    name: string;
    active: boolean;
    sortOrder: number;
    productId: string;
    modules: readonly string[];
  }[];
  readonly prices: readonly {
    lookupKey: string;
    planKey: string;
    currency: string;
    interval: 'month' | 'year';
    unitAmountMinor: number | null;
    active: boolean;
    priceId: string;
  }[];
  readonly features: readonly { moduleKey: string; featureId: string; active: boolean }[];
  /** Provider objects the mirror leaves out, and why (logged by the sync). */
  readonly skipped: readonly { kind: 'product' | 'price' | 'feature'; id: string; reason: string }[];
}

/**
 * Map the provider's catalog onto the plan tables (M6.6a): a product with a `plan_key` is a plan,
 * its Entitlement Features (module keys only) are the plan's modules, and a recurring price with a
 * lookup key is one of the plan's prices. Pure, so the worker's sync and its tests share it; the
 * database side is `billing.apply_catalog` (platform_reader only). The legacy `launch_standard`
 * plan is never sold and never touched.
 */
export function catalogSyncPayload(catalog: ProviderCatalog): CatalogSyncPayload {
  const skipped: { kind: 'product' | 'price' | 'feature'; id: string; reason: string }[] = [];
  const planOf = new Map<string, string>();
  const plans: CatalogSyncPayload['plans'][number][] = [];
  for (const p of catalog.products) {
    if (!p.planKey) {
      skipped.push({ kind: 'product', id: p.id, reason: 'no plan_key' });
      continue;
    }
    if (!PLAN_KEY_PATTERN.test(p.planKey) || p.planKey === DEFAULT_PLAN) {
      skipped.push({ kind: 'product', id: p.id, reason: `plan_key not allowed: ${p.planKey}` });
      continue;
    }
    if (plans.some((x) => x.key === p.planKey)) {
      skipped.push({ kind: 'product', id: p.id, reason: `duplicate plan_key: ${p.planKey}` });
      continue;
    }
    planOf.set(p.id, p.planKey);
    plans.push({
      key: p.planKey,
      name: p.name.trim().slice(0, 100) || p.planKey,
      active: p.active,
      sortOrder: Math.min(1000, Math.max(0, Math.trunc(p.sortOrder))),
      productId: p.id,
      modules: [...new Set(p.features.filter(isModuleKey))].sort(),
    });
  }
  const prices: CatalogSyncPayload['prices'][number][] = [];
  for (const x of catalog.prices) {
    const planKey = planOf.get(x.productId);
    const reason = !planKey
      ? 'product is not a plan'
      : !x.lookupKey || !LOOKUP_KEY.test(x.lookupKey)
        ? 'no usable lookup_key'
        : !x.interval
          ? 'not recurring monthly or yearly'
          : !/^[A-Z]{3}$/.test(x.currency)
            ? 'bad currency'
            : null;
    if (reason || !planKey || !x.lookupKey || !x.interval) {
      skipped.push({ kind: 'price', id: x.id, reason: reason ?? 'unusable' });
      continue;
    }
    prices.push({
      lookupKey: x.lookupKey,
      planKey,
      currency: x.currency,
      interval: x.interval,
      unitAmountMinor: x.unitAmountMinor,
      active: x.active,
      priceId: x.id,
    });
  }
  const features: CatalogSyncPayload['features'][number][] = [];
  for (const f of catalog.features) {
    if (!isModuleKey(f.lookupKey)) {
      skipped.push({ kind: 'feature', id: f.id, reason: `not a module key: ${f.lookupKey}` });
      continue;
    }
    features.push({ moduleKey: f.lookupKey, featureId: f.id, active: f.active });
  }
  return { plans, prices, features, skipped };
}
