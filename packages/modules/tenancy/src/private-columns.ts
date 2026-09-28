import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `tenancy` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('tenancy', {
  agreement_acceptances: { document: 'vocab', version: 'vocab' },
  api_keys: { name: internal(), prefix: internal('key-prefix'), key_hash: secret(), scopes: 'vocab' },
  invitations: { email: personal('email'), role: 'vocab' },
  // Published legal pages (refund policy, terms) are public.
  legal_pages: { kind: 'vocab', body: 'public' },
  memberships: { role: 'vocab' },
  org_domains: {
    hostname: 'public',
    kind: 'vocab',
    status: 'vocab',
    provider_ref: secret(),
    records: internal(),
    ssl_status: 'vocab',
    payment_method_domain_id: secret(),
    failure_reason: internal(),
  },
  org_relationships: { kind: 'vocab', source: 'vocab' },
  // Staff status changes (M1.3f): the reason and who made it stay in the staff console.
  org_status_changes: {
    action: 'vocab',
    from_status: 'vocab',
    to_status: 'vocab',
    reason: internal(),
    changed_by: internal(),
  },
  org_suspensions: { kind: 'vocab', reason: internal(), created_by: internal(), lifted_by: internal() },
  organizations: {
    slug: 'public',
    name: 'public',
    kind: 'vocab',
    status: 'vocab',
    default_profile: 'vocab',
    default_locale: 'vocab',
    timezone: 'vocab',
    country: 'vocab',
    currency: 'vocab',
    brand_color: 'public',
    legacy_instance: 'vocab',
    // The brand kit logo (M1.4e) is public for a live org.
    logo_path: 'public',
    logo_alt: 'public',
  },
});
