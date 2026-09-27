import { withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { organizationPublicTx, resolveOrgSlug } from '@yayatoh/tenancy';
import { asc, count, gt, sql } from 'drizzle-orm';
import { type RedirectRule, redirectLocation } from './domain/redirects.ts';
import { dayRange, escapeLike, PAGE_SIZE, pageCount, type SearchParams } from './domain/search.ts';
import {
  type ListingDto,
  type ListingPageDto,
  listingSerializer,
  type SitemapListingDto,
  SitemapListingDto as SitemapListingSchema,
  type SiteSettingsDto,
  siteSettingsSerializer,
} from './dto.ts';
import { settingsTx } from './projector.ts';
import { publicListings } from './schema.ts';

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

function toListing(r: Row): ListingDto {
  return listingSerializer.serialize({
    slug: r.slug,
    name: r.name,
    tagline: r.tagline ?? null,
    profile: r.profile,
    status: r.status,
    timezone: r.timezone,
    startsAt: date(r.starts_at ?? r.startsAt),
    endsAt: date(r.ends_at ?? r.endsAt),
    venueName: r.venue_name ?? r.venueName ?? null,
    city: r.city ?? null,
    country: r.country ?? null,
    currency: r.currency,
    minPriceMinor: num(r.min_price_minor ?? r.minPriceMinor),
    maxPriceMinor: num(r.max_price_minor ?? r.maxPriceMinor),
    orgSlug: r.org_slug ?? r.orgSlug,
    orgName: r.org_name ?? r.orgName,
    canonicalHost: r.canonical_host ?? r.canonicalHost ?? null,
    updatedAt: date(r.source_updated_at ?? r.sourceUpdatedAt),
  });
}

/**
 * Marketplace search (cross-tenant) through the SECURITY DEFINER `marketplace.search_listings`:
 * upcoming and ongoing listings only, allowlisted columns only. `orgSlug` narrows to one
 * organizer (the `/o/{slug}` page, which also shows events not enrolled on the marketplace).
 */
export async function searchListings(
  p: SearchParams & { orgSlug?: string },
  now: Date = new Date(),
): Promise<ListingPageDto> {
  const { from, to } = dayRange(p);
  const offset = (p.page - 1) * PAGE_SIZE;
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(sql`select * from marketplace.search_listings(
      ${p.q ? escapeLike(p.q) : null}, ${p.city ?? null}, ${p.category ?? null},
      ${from ? from.toISOString() : null}::timestamptz, ${to ? to.toISOString() : null}::timestamptz,
      ${p.price ?? null}, ${p.orgSlug ?? null}, ${!p.orgSlug}, ${now.toISOString()}::timestamptz,
      ${PAGE_SIZE}, ${offset})`),
  );
  const total = rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0;
  return { items: rows.map(toListing), total, page: p.page, pageCount: pageCount(total) };
}

/** Cities with upcoming marketplace listings (the city filter's options). */
export async function listingCities(now: Date = new Date()): Promise<string[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ city: string }>(
      sql`select city from marketplace.listing_cities(${now.toISOString()}::timestamptz)`,
    ),
  );
  return rows.map((r) => r.city);
}

/** One listing by event slug (canonical URL, organizer link), cross-tenant; null when not listed. */
export async function listingBySlug(slug: string): Promise<(ListingDto & { readonly orgId: string }) | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(sql`select * from marketplace.listing_by_slug(${slug})`),
  );
  const r = rows[0];
  if (!r) return null;
  // orgId stays server-side (cache keys, tenant-host checks); it is not part of the DTO.
  return Object.assign(toListing(r), { orgId: String(r.org_id) });
}

/** A tenant site's own listings (its home page), under RLS in the org's transaction. */
export async function orgListings(orgId: string, page = 1, now: Date = new Date()): Promise<ListingPageDto> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'marketplace.tenant-site' } });
  return withTenant(ctx, async (tx) => {
    const upcoming = gt(publicListings.endsAt, now);
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(publicListings).where(upcoming);
    const rows = await tx
      .select()
      .from(publicListings)
      .where(upcoming)
      .orderBy(asc(publicListings.startsAt), asc(publicListings.slug))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    return {
      items: rows.map((r) => toListing(r as unknown as Row)),
      total: n,
      page,
      pageCount: pageCount(n),
    };
  });
}

/**
 * Sitemap entries for one host: `null` = the marketplace apex (listings whose canonical home is
 * the apex), else the org's listings whose canonical host is that host.
 */
export async function sitemapListings(canonicalHost: string | null): Promise<SitemapListingDto[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(sql`select * from marketplace.sitemap_listings(${canonicalHost})`),
  );
  return rows.map((r) =>
    SitemapListingSchema.parse({ slug: r.slug, orgSlug: r.org_slug, updatedAt: date(r.source_updated_at) }),
  );
}

/** The org's public site settings (tenant site switch, embed origins), read as a system actor. */
export async function publicSiteSettings(orgId: string): Promise<SiteSettingsDto> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'marketplace.public-settings' } });
  return siteSettingsSerializer.serialize(await withTenant(ctx, (tx) => settingsTx(tx)));
}

/** The public face of an organizer by slug (`/o/{slug}`), or null for unknown or inactive orgs. */
export async function publicOrganizer(slug: string): Promise<{
  readonly orgId: string;
  readonly slug: string;
  readonly name: string;
  readonly brandColor: string | null;
  readonly primaryHost: string | null;
  readonly tenantSite: boolean;
} | null> {
  const found = await resolveOrgSlug(slug);
  if (!found) return null;
  const ctx = createCtx({ orgId: found.orgId, actor: { type: 'system', name: 'marketplace.organizer' } });
  return withTenant(ctx, async (tx) => {
    const org = await organizationPublicTx(tx, found.orgId);
    if (!org || (org.status !== 'active' && org.status !== 'limited')) return null;
    const settings = await settingsTx(tx);
    return {
      orgId: found.orgId,
      slug: org.slug,
      name: org.name,
      brandColor: org.brandColor,
      primaryHost: org.primaryHost,
      tenantSite: settings.tenantSite || (org.primaryHost !== null && !org.primaryHostManaged),
    };
  });
}

/**
 * The legacy redirect for a request (roadmap §7.7), through the SECURITY DEFINER
 * `marketplace.match_redirect`, which also counts the hit. A rule for the exact host wins over
 * a `*` rule. Returns the Location and status, or null.
 */
export async function matchLegacyRedirect(
  host: string,
  pathWithQuery: string,
): Promise<{ location: string; status: number } | null> {
  const path = pathWithQuery.split('?')[0] ?? '/';
  const rows = await withoutTenant((tx) =>
    tx.execute<{ source: string; match: 'exact' | 'prefix'; target: string; status: number }>(
      sql`select source, match, target, status from marketplace.match_redirect(${host.toLowerCase()}, ${path})`,
    ),
  );
  const r = rows[0];
  if (!r) return null;
  const rule: RedirectRule = { source: r.source, match: r.match, target: r.target, status: Number(r.status) };
  return { location: redirectLocation(rule, pathWithQuery), status: rule.status };
}
