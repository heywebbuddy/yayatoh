import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `billing` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('billing', {
  entitlement_overrides: { module_key: 'vocab', effect: 'vocab', reason: internal() },
  org_fee_overrides: { currency: 'vocab', reason: internal() },
  org_plans: { plan_key: 'vocab' },
});
