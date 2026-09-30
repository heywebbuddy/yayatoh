import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const marketplaceSchema = pgSchema('marketplace');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Event statuses a listing can carry (roadmap §5.2): everything else removes the listing. */
export const LISTED_STATUSES = ['published', 'postponed'] as const;
export const REDIRECT_MATCHES = ['exact', 'prefix'] as const;
export const REDIRECT_STATUSES = [301, 302, 307, 308] as const;

/**
 * The public listings projection (roadmap §3.3 "Marketplace isolation"): one row per public,
 * published or postponed event, rebuilt from its sources by the `marketplace.listings` projector.
 * Allowlisted columns only: no PII, no org internals. Cross-tenant reads go through SECURITY
 * DEFINER functions (search, sitemap); a tenant site reads its own rows under RLS.
 */
export const publicListings = tenantTable(
  marketplaceSchema,
  'public_listings',
  {
    eventId: uuid('event_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    tagline: text('tagline'),
    profile: text('profile').notNull(),
    status: text('status').notNull(),
    timezone: text('timezone').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    venueName: text('venue_name'),
    city: text('city'),
    country: text('country'),
    currency: text('currency').notNull(),
    /** All-in price range of the public ticket types; null when nothing is on sale yet. */
    minPriceMinor: bigint('min_price_minor', { mode: 'number' }),
    maxPriceMinor: bigint('max_price_minor', { mode: 'number' }),
    orgSlug: text('org_slug').notNull(),
    orgName: text('org_name').notNull(),
    /** Shown on the marketplace (org enrolled, D13; never weddings). Tenant sites list every row. */
    onMarketplace: boolean('on_marketplace').notNull().default(false),
    /** The event's canonical host (roadmap §4.2); null = the marketplace apex. */
    canonicalHost: text('canonical_host'),
    publishedAt: ts('published_at'),
    /** When the source last changed (sitemap lastmod). */
    sourceUpdatedAt: ts('source_updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('public_listings_org_event_key').on(t.orgId, t.eventId),
    // Event slugs are global (yayatoh.com/events/{slug}), so is the listing's.
    uniqueIndex('public_listings_slug_key').on(t.slug),
    index('public_listings_org_id_starts_at_idx').on(t.orgId, t.startsAt),
    // The cross-tenant search (SECURITY DEFINER) scans upcoming marketplace rows by date.
    index('public_listings_marketplace_starts_at_idx').on(t.startsAt).where(sql`on_marketplace`),
    check('public_listings_status_check', sql`status in ('published', 'postponed')`),
    check('public_listings_price_check', sql`min_price_minor is null or min_price_minor <= max_price_minor`),
  ],
);

/**
 * Per-org public site settings: marketplace enrollment (owner D13: opt-in for new orgs), whether
 * the org runs a tenant site (canonical rule 2, roadmap §4.2) and the origins allowed to embed
 * its ticket widget (M1.11c, CSP frame-ancestors). One row per org; absent = defaults.
 */
export const siteSettings = tenantTable(
  marketplaceSchema,
  'site_settings',
  {
    listOnMarketplace: boolean('list_on_marketplace').notNull().default(false),
    tenantSite: boolean('tenant_site').notNull().default(false),
    embedOrigins: text('embed_origins').array().notNull().default(sql`'{}'::text[]`),
    /** M1.4g: CMS pages linked from the tenant site's navigation, in order (at most 8). */
    navPageIds: uuid('nav_page_ids').array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [
    uniqueIndex('site_settings_org_key').on(t.orgId),
    check('site_settings_embed_origins_check', sql`cardinality(embed_origins) <= 10`),
    check('site_settings_nav_page_ids_check', sql`cardinality(nav_page_ids) <= 8`),
  ],
);

/**
 * Legacy URL map (roadmap §7.7): `(host, source)` → target with a 3xx status, served by proxy.ts
 * and kept at least 12 months. Owned by the org whose content the target is. Written by the
 * migration tooling (system actor) only. **Exception, on purpose:** `(host, source)` is unique
 * globally, not per org, because a URL on a host can only go one place (like org_domains).
 * `host` is a hostname or `*` (every platform host).
 */
export const legacyRedirects = tenantTable(
  marketplaceSchema,
  'legacy_redirects',
  {
    host: text('host').notNull(),
    source: text('source').notNull(),
    match: text('match').notNull().default('exact'),
    target: text('target').notNull(),
    status: integer('status').notNull().default(308),
    hits: bigint('hits', { mode: 'number' }).notNull().default(0),
    lastHitAt: ts('last_hit_at'),
  },
  (t) => [
    uniqueIndex('legacy_redirects_host_source_key').on(t.host, t.source),
    check('legacy_redirects_match_check', sql`match in ('exact', 'prefix')`),
    check('legacy_redirects_status_check', sql`status in (301, 302, 307, 308)`),
    check('legacy_redirects_source_check', sql`source ~ '^/' and length(source) <= 2000`),
    check('legacy_redirects_target_check', sql`target ~ '^(/|https://)' and length(target) <= 2000`),
  ],
);
