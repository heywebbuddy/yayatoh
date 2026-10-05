import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Price bands of the search facet, in major units of the listing's currency (M6.14a). */
export const PRICE_BANDS = ['free', 'under_25', 'from_25_to_100', 'over_100', 'unpriced'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

/** ISO 4217 currencies without minor units that the platform sells in (the rest have two). */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'XAF', 'XOF', 'CLP', 'ISK', 'UGX', 'RWF', 'VND']);

/**
 * The band of a listing's cheapest public ticket. Bands are coarse and in the listing's own
 * currency (a facet for browsing, not a price comparison across currencies).
 */
export function priceBand(minMinor: number | null, maxMinor: number | null, currency: string): PriceBand {
  if (minMinor === null || maxMinor === null) return 'unpriced';
  if (maxMinor === 0) return 'free';
  const major = minMinor / (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100);
  if (major < 25) return 'under_25';
  if (major <= 100) return 'from_25_to_100';
  return 'over_100';
}

/**
 * One search document (M6.14a): built only from the public read model (`public_listings`), every
 * field allowlisted here (`.strict()`: anything else fails). No org or event ids: `id` is an opaque
 * hash, stable across renames. `_geo` is the venue's rounded public location.
 */
export const SearchDocument = z
  .object({
    id: z.string().regex(/^l[0-9a-f]{32}$/),
    slug: z.string(),
    name: z.string(),
    tagline: z.string().nullable(),
    category: z.string().nullable(),
    profile: z.string(),
    venueName: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    orgSlug: z.string(),
    orgName: z.string(),
    currency: z.string(),
    minPriceMinor: z.number().int().nullable(),
    priceBand: z.enum(PRICE_BANDS),
    /** Unix seconds (numeric filters and sorting). */
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    popularity: z.number().int().min(0),
    _geo: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  })
  .strict();
export type SearchDocument = z.infer<typeof SearchDocument>;

/**
 * Where each indexed field comes from: a `public_listings` column (SQL name). The leak crawler's
 * coverage test checks that every field is here and every source column is declared public or
 * vocab in `private-columns.ts` (or is not text at all).
 */
export const INDEXED_FIELDS: Readonly<Record<keyof SearchDocument, readonly string[]>> = {
  id: ['org_id', 'event_id'],
  slug: ['slug'],
  name: ['name'],
  tagline: ['tagline'],
  category: ['category'],
  profile: ['profile'],
  venueName: ['venue_name'],
  city: ['city'],
  country: ['country'],
  orgSlug: ['org_slug'],
  orgName: ['org_name'],
  currency: ['currency'],
  minPriceMinor: ['min_price_minor'],
  priceBand: ['min_price_minor', 'max_price_minor', 'currency'],
  startsAt: ['starts_at'],
  endsAt: ['ends_at'],
  popularity: ['popularity'],
  _geo: ['latitude', 'longitude'],
};

/** Opaque, stable document id of one listing (never reveals the org or event id). */
export function docIdFor(orgId: string, eventId: string): string {
  return `l${createHash('sha256').update(`listing:${orgId}:${eventId}`).digest('hex').slice(0, 32)}`;
}

/** The projection row fields a document is built from. */
export interface IndexableListing {
  readonly orgId: string;
  readonly eventId: string;
  readonly slug: string;
  readonly name: string;
  readonly tagline: string | null;
  readonly category: string | null;
  readonly profile: string;
  readonly venueName: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly orgSlug: string;
  readonly orgName: string;
  readonly currency: string;
  readonly minPriceMinor: number | null;
  readonly maxPriceMinor: number | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly popularity: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly onMarketplace: boolean;
}

/**
 * Whether a projection row may be in the index: on the marketplace and never a wedding (D13, even
 * if a row were mis-flagged: the projection already excludes them, this is the second lock).
 */
export function isIndexable(row: Pick<IndexableListing, 'onMarketplace' | 'profile'>): boolean {
  return row.onMarketplace && row.profile !== 'wedding';
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** The search document of a projection row, or null when it must not be indexed. */
export function toSearchDocument(row: IndexableListing): SearchDocument | null {
  if (!isIndexable(row)) return null;
  return SearchDocument.parse({
    id: docIdFor(row.orgId, row.eventId),
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    category: row.category,
    profile: row.profile,
    venueName: row.venueName,
    city: row.city,
    country: row.country,
    orgSlug: row.orgSlug,
    orgName: row.orgName,
    currency: row.currency,
    minPriceMinor: row.minPriceMinor,
    priceBand: priceBand(row.minPriceMinor, row.maxPriceMinor, row.currency),
    startsAt: unix(row.startsAt),
    endsAt: unix(row.endsAt),
    popularity: row.popularity,
    _geo: row.latitude !== null && row.longitude !== null ? { lat: row.latitude, lng: row.longitude } : null,
  });
}

/** Round a coordinate to 3 decimals (about 100 m): enough for "near me", not a street address. */
export const roundCoord = (v: number) => Math.round(v * 1000) / 1000;
