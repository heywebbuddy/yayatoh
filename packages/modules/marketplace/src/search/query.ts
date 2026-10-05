import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ListingDto, listingSerializer } from '../dto.ts';
import { PRICE_BANDS, type SearchDocument } from './document.ts';
import {
  DEFAULT_RADIUS_KM,
  SEARCH_PAGE_SIZE,
  type SearchV2Params,
  WHEN_PRESETS,
  type WhenPreset,
  whenWindow,
} from './params.ts';
import type { FacetField, Filter, SearchHits, SearchIndex, SearchQuery, Sort } from './port.ts';

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** A search result: a public listing (from the read model) and its distance, when geo-sorted. */
export const SearchListingDto = ListingDto.extend({ distanceKm: z.number().nullable() });
export type SearchListingDto = z.infer<typeof SearchListingDto>;

const FacetCount = z.object({ value: z.string(), count: z.number().int() });
export const SearchResultDto = z.object({
  items: z.array(SearchListingDto),
  total: z.number().int(),
  page: z.number().int(),
  pageCount: z.number().int(),
  facets: z.object({
    category: z.array(FacetCount),
    city: z.array(FacetCount),
    price: z.array(FacetCount),
    when: z.array(FacetCount),
  }),
  /** The geo search's centre, when there is one (the city name, or `me`). */
  near: z.object({ label: z.string(), radiusKm: z.number() }).nullable(),
});
export type SearchResultDto = z.infer<typeof SearchResultDto>;

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Listings by slug from the public read model (SECURITY DEFINER `marketplace.listings_by_slugs`:
 * marketplace rows of live orgs, never weddings, not yet ended), in the order asked. Every search
 * and recommendation goes through this: a stale index entry simply isn't returned.
 */
export async function listingsBySlugs(
  slugs: readonly string[],
  now: Date = new Date(),
): Promise<ListingDto[]> {
  if (slugs.length === 0) return [];
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(
      sql`select * from marketplace.listings_by_slugs(${sql`array[${sql.join(
        slugs.map((s) => sql`${s}`),
        sql`, `,
      )}]::text[]`}, ${now.toISOString()}::timestamptz)`,
    ),
  );
  const bySlug = new Map(
    rows.map((r) => [
      String(r.slug),
      listingSerializer.serialize({
        slug: r.slug,
        name: r.name,
        tagline: r.tagline ?? null,
        profile: r.profile,
        status: r.status,
        timezone: r.timezone,
        startsAt: date(r.starts_at),
        endsAt: date(r.ends_at),
        venueName: r.venue_name ?? null,
        city: r.city ?? null,
        country: r.country ?? null,
        currency: r.currency,
        minPriceMinor: num(r.min_price_minor),
        maxPriceMinor: num(r.max_price_minor),
        orgSlug: r.org_slug,
        orgName: r.org_name,
        canonicalHost: r.canonical_host ?? null,
        updatedAt: date(r.source_updated_at),
      }),
    ]),
  );
  return slugs.flatMap((s) => bySlug.get(s) ?? []);
}

/** Cities with a geo centre (the "near" options): the mean of their listings' public locations. */
export async function cityCenters(
  now: Date = new Date(),
): Promise<{ city: string; lat: number; lng: number }[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ city: string; lat: number; lng: number }>(
      sql`select city, lat, lng from marketplace.listing_city_centers(${now.toISOString()}::timestamptz)`,
    ),
  );
  return rows.map((r) => ({ city: r.city, lat: Number(r.lat), lng: Number(r.lng) }));
}

const upcoming = (now: Date): Filter => ({ field: 'endsAt', gte: unix(now) + 1 });

function whenFilter(preset: WhenPreset, now: Date): Filter {
  return { field: 'startsAt', lt: whenWindow(preset, now).startsBefore };
}

/** The filters of a search, by facet (so each facet's counts can leave its own filter out). */
export function filtersOf(p: SearchV2Params, now: Date, center: (GeoPoint & { radiusKm: number }) | null) {
  const f: Record<'base' | 'category' | 'city' | 'price' | 'when', Filter[]> = {
    base: [upcoming(now)],
    category: [],
    city: [],
    price: [],
    when: [],
  };
  if (p.category) f.category.push({ field: 'category', eq: p.category });
  // A city given as the geo centre is a radius, not an exact match.
  if (p.city && !(center && p.near?.toLowerCase() === p.city.toLowerCase()))
    f.city.push({ field: 'city', eq: p.city });
  if (p.price) f.price.push({ field: 'priceBand', eq: p.price });
  if (p.when) f.when.push(whenFilter(p.when, now));
  if (p.from) f.when.push({ field: 'endsAt', gte: unix(new Date(`${p.from}T00:00:00Z`)) });
  if (p.to) f.when.push({ field: 'startsAt', lt: unix(new Date(`${p.to}T00:00:00Z`)) + 86_400 });
  if (center) f.base.push({ geo: { lat: center.lat, lng: center.lng, radiusM: center.radiusKm * 1000 } });
  return f;
}

export const all = (f: ReturnType<typeof filtersOf>, without?: keyof ReturnType<typeof filtersOf>) =>
  (Object.keys(f) as (keyof typeof f)[]).filter((k) => k !== without).flatMap((k) => f[k]);

function sortOf(p: SearchV2Params, center: GeoPoint | null): Sort[] {
  const sort = p.sort ?? (center ? 'nearest' : 'soonest');
  if (sort === 'nearest' && center) return [{ nearest: center }, { field: 'startsAt', dir: 'asc' }];
  if (sort === 'popular')
    return [
      { field: 'popularity', dir: 'desc' },
      { field: 'startsAt', dir: 'asc' },
    ];
  return [{ field: 'startsAt', dir: 'asc' }];
}

const counts = (h: SearchHits | undefined, field: FacetField) =>
  Object.entries(h?.facets[field] ?? {})
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

/** Resolve the geo centre: the browser's location (`near=me`) or a city's centre. */
export function resolveCenter(
  p: SearchV2Params,
  centers: readonly { city: string; lat: number; lng: number }[],
): (GeoPoint & { label: string; radiusKm: number }) | null {
  const radiusKm = p.radius ?? DEFAULT_RADIUS_KM;
  if (p.near === 'me') {
    if (p.lat === undefined || p.lng === undefined) return null;
    return { lat: p.lat, lng: p.lng, label: 'me', radiusKm };
  }
  if (!p.near) return null;
  const c = centers.find((x) => x.city.toLowerCase() === p.near?.toLowerCase());
  return c ? { lat: c.lat, lng: c.lng, label: c.city, radiusKm } : null;
}

export async function hydrate(hits: SearchHits['hits'], now: Date): Promise<SearchListingDto[]> {
  const listings = await listingsBySlugs(
    hits.map((h) => h.doc.slug),
    now,
  );
  const dist = new Map(hits.map((h) => [h.doc.slug, h.distanceM]));
  return listings.map((l) => {
    const m = dist.get(l.slug);
    return SearchListingDto.parse({
      ...l,
      distanceKm: m === null || m === undefined ? null : Math.round(m / 100) / 10,
    });
  });
}

/**
 * Marketplace search v2 (M6.14a): one multi-search round trip — the page of results, each facet's
 * counts without its own filter (so a visitor sees the alternatives), and the date presets'
 * counts. Results are hydrated from the public read model; the index only decides the order.
 */
export async function searchMarketplace(
  index: SearchIndex,
  p: SearchV2Params,
  now: Date = new Date(),
): Promise<SearchResultDto> {
  const center = resolveCenter(p, p.near && p.near !== 'me' ? await cityCenters(now) : []);
  const f = filtersOf(p, now, center);
  const text = p.q;
  const count = (filters: Filter[], facets: FacetField[] = []): SearchQuery => ({
    ...(text ? { text } : {}),
    filters,
    facets,
    page: 1,
    hitsPerPage: 0,
  });
  const main: SearchQuery = {
    ...(text ? { text } : {}),
    filters: all(f),
    sort: sortOf(p, center),
    page: p.page,
    hitsPerPage: SEARCH_PAGE_SIZE,
  };
  const whenBase = all(f, 'when');
  const [res, cat, city, price, ...when] = await index.search([
    main,
    count(all(f, 'category'), ['category']),
    count(all(f, 'city'), ['city']),
    count(all(f, 'price'), ['priceBand']),
    ...WHEN_PRESETS.map((w) => count([...whenBase, whenFilter(w, now)])),
  ]);
  const total = res?.total ?? 0;
  return SearchResultDto.parse({
    items: await hydrate(res?.hits ?? [], now),
    total,
    page: p.page,
    pageCount: Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
    facets: {
      category: counts(cat, 'category'),
      city: counts(city, 'city'),
      price: counts(price, 'priceBand').filter((c) => (PRICE_BANDS as readonly string[]).includes(c.value)),
      when: WHEN_PRESETS.map((w, i) => ({ value: w, count: when[i]?.total ?? 0 })),
    },
    near: center ? { label: center.label, radiusKm: center.radiusKm } : null,
  });
}

export const RECOMMENDATIONS = 6;
export const NEARBY_RADIUS_KM = 50;

/** Popular upcoming listings (the organizer's public review count), soonest first among equals. */
export async function popularListings(
  index: SearchIndex,
  now: Date = new Date(),
  opts: { excludeSlug?: string; limit?: number } = {},
): Promise<SearchListingDto[]> {
  const [res] = await index.search([
    {
      filters: [
        upcoming(now),
        ...(opts.excludeSlug ? [{ field: 'slug' as const, ne: opts.excludeSlug }] : []),
      ],
      sort: [
        { field: 'popularity', dir: 'desc' },
        { field: 'startsAt', dir: 'asc' },
      ],
      page: 1,
      hitsPerPage: opts.limit ?? RECOMMENDATIONS,
    },
  ]);
  return hydrate(res?.hits ?? [], now);
}

/** Upcoming listings near a point, nearest first. */
export async function nearbyListings(
  index: SearchIndex,
  point: GeoPoint,
  now: Date = new Date(),
  opts: { excludeSlug?: string; limit?: number; radiusKm?: number } = {},
): Promise<SearchListingDto[]> {
  const [res] = await index.search([
    {
      filters: [
        upcoming(now),
        { geo: { ...point, radiusM: (opts.radiusKm ?? NEARBY_RADIUS_KM) * 1000 } },
        ...(opts.excludeSlug ? [{ field: 'slug' as const, ne: opts.excludeSlug }] : []),
      ],
      sort: [{ nearest: point }, { field: 'startsAt', dir: 'asc' }],
      page: 1,
      hitsPerPage: opts.limit ?? RECOMMENDATIONS,
    },
  ]);
  return hydrate(res?.hits ?? [], now);
}

export const SimilarDto = z.object({
  anchor: z.object({ slug: z.string(), name: z.string() }),
  similar: z.array(SearchListingDto),
  nearby: z.array(SearchListingDto),
});
export type SimilarDto = z.infer<typeof SimilarDto>;

/**
 * Recommendations around one listing (M6.14a): similar events (same category, else same city,
 * nearest or soonest first) and events nearby. Null when the listing is not in the index.
 */
export async function similarListings(
  index: SearchIndex,
  slug: string,
  now: Date = new Date(),
): Promise<SimilarDto | null> {
  const [found] = await index.search([{ filters: [{ field: 'slug', eq: slug }], page: 1, hitsPerPage: 1 }]);
  const anchor: SearchDocument | undefined = found?.hits[0]?.doc;
  // The anchor must still be a public listing (a stale index entry is not one).
  const [visible] = anchor ? await listingsBySlugs([anchor.slug], now) : [];
  if (!anchor || !visible) return null;
  const not: Filter = { field: 'slug', ne: anchor.slug };
  const like: Filter[] = anchor.category
    ? [{ field: 'category', eq: anchor.category }]
    : anchor.city
      ? [{ field: 'city', eq: anchor.city }]
      : [];
  const point = anchor._geo;
  const [res] = await index.search([
    {
      filters: [upcoming(now), not, ...like],
      sort: point
        ? [{ nearest: point }, { field: 'startsAt', dir: 'asc' }]
        : [{ field: 'startsAt', dir: 'asc' }],
      page: 1,
      hitsPerPage: RECOMMENDATIONS,
    },
  ]);
  return SimilarDto.parse({
    anchor: { slug: visible.slug, name: visible.name },
    similar: await hydrate(res?.hits ?? [], now),
    nearby: point ? await nearbyListings(index, point, now, { excludeSlug: anchor.slug }) : [],
  });
}
