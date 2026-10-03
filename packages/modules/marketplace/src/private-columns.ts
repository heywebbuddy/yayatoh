import { columnPrivacy } from '@yayatoh/db';

/**
 * Column privacy of the `marketplace` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('marketplace', {
  // Redirects are public behaviour (their targets are public pages).
  legacy_redirects: { host: 'public', source: 'public', match: 'vocab', target: 'public' },
  // The projection holds allowlisted public fields only (M1.11a).
  public_listings: {
    slug: 'public',
    name: 'public',
    tagline: 'public',
    profile: 'vocab',
    status: 'vocab',
    timezone: 'vocab',
    venue_name: 'public',
    city: 'public',
    country: 'vocab',
    currency: 'vocab',
    org_slug: 'public',
    org_name: 'public',
    canonical_host: 'public',
    // U8: an event's tags are shown on its public page and the org site's tag filter.
    tags: 'public',
    tag_keys: 'public',
  },
  // Sent to every browser in the widget's CSP frame-ancestors.
  site_settings: { embed_origins: 'public' },
});
