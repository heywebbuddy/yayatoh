import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `billing` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('billing', {
  event_addons: { addon_key: 'vocab', source: 'vocab', currency: 'vocab' },
  entitlement_overrides: { module_key: 'vocab', effect: 'vocab', reason: internal() },
  org_fee_overrides: { currency: 'vocab', reason: internal() },
  org_plans: { plan_key: 'vocab' },
  org_billing: {
    provider: 'vocab',
    provider_customer_id: internal(),
    grandfathered_reason: 'vocab',
  },
  subscriptions: {
    provider: 'vocab',
    provider_subscription_id: internal(),
    provider_customer_id: internal(),
    status: 'vocab',
    plan_key: 'vocab',
    price_lookup_key: 'vocab',
  },
  org_entitlements: { module_key: 'vocab', provider: 'vocab' },
  provider_events: { provider: 'vocab', provider_event_id: internal(), type: 'vocab' },
});
