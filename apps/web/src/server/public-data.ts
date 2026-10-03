import 'server-only';
import {
  cityCenters,
  type ListingDto,
  type ListingPageDto,
  listingCities,
  orgListings,
  popularListings,
  promotedPlacements,
  promotedPlacementsEnabled,
  type SearchListingDto,
  type SearchParams,
  type SearchResultDto,
  type SearchV2Params,
  type SimilarDto,
  searchListings,
  searchMarketplace,
  similarListings,
} from '@yayatoh/marketplace';
import { type PublicReviewSummaryDto, publicReviews } from '@yayatoh/reviews';
import { publicCached } from './public-cache.ts';
import { searchIndex } from './search.ts';

type Raw = Record<string, unknown>;
const reviveListing = (l: Raw) =>
  ({
    ...l,
    startsAt: new Date(String(l.startsAt)),
    endsAt: new Date(String(l.endsAt)),
    updatedAt: new Date(String(l.updatedAt)),
  }) as ListingDto;
const revivePage = (raw: unknown): ListingPageDto => {
  const p = raw as ListingPageDto & { items: Raw[] };
  return { ...p, items: p.items.map(reviveListing) };
};

/** Marketplace search (cross-tenant projection), cached under the marketplace scope. */
export const cachedMarketplace = (p: SearchParams) =>
  publicCached('marketplace', ['search', p], () => searchListings(p), revivePage);

/** An organizer page's listings: one org's data, so it is cached under that org's scope. */
export const cachedOrganizerListings = (orgId: string, orgSlug: string, p: SearchParams) =>
  publicCached(
    { org: orgId },
    ['organizer', orgSlug, p],
    () => searchListings({ ...p, orgSlug }),
    revivePage,
  );

/** A tenant site's own listings, cached under the org's scope. */
export const cachedTenantListings = (orgId: string, page: number) =>
  publicCached({ org: orgId }, ['tenant-home', page], () => orgListings(orgId, page), revivePage);

export const cachedCities = () =>
  publicCached(
    'marketplace',
    ['cities'],
    () => listingCities(),
    (raw) => raw as string[],
  );

/** An event's public reviews (M1.4g), cached under its org's scope (moderation revalidates it). */
export const cachedReviews = (orgId: string, eventId: string) =>
  publicCached(
    { org: orgId },
    ['reviews', eventId],
    () => publicReviews(orgId, eventId),
    (raw) => {
      const s = raw as PublicReviewSummaryDto & { recent: Raw[] };
      return {
        ...s,
        recent: s.recent.map((r) => ({ ...r, createdAt: new Date(String(r.createdAt)) })),
      } as PublicReviewSummaryDto;
    },
  );

// M6.14a search v2: cross-tenant reads of the index (public listings only), so every entry is in
// the marketplace scope, which any org's change revalidates (`orgChangeTags`).
const reviveItems = (items: Raw[]) => items.map(reviveListing) as SearchListingDto[];

async function requireIndex() {
  const index = await searchIndex();
  if (!index) throw new Error('search v2 is off');
  return index;
}

/** A search v2 page (results, facets, geo centre). Callers check `searchEnabled()` first. */
export const cachedSearch = (p: SearchV2Params) =>
  publicCached(
    'marketplace',
    ['search-v2', p],
    async () => searchMarketplace(await requireIndex(), p),
    (raw) => {
      const r = raw as SearchResultDto & { items: Raw[] };
      return { ...r, items: reviveItems(r.items) };
    },
  );

/** Similar and nearby events around one listing (null when it is not a public listing). */
export const cachedSimilar = (slug: string) =>
  publicCached(
    'marketplace',
    ['similar', slug],
    async () => similarListings(await requireIndex(), slug),
    (raw) => {
      if (!raw) return null;
      const r = raw as SimilarDto & { similar: Raw[]; nearby: Raw[] };
      return { ...r, similar: reviveItems(r.similar), nearby: reviveItems(r.nearby) } as SimilarDto;
    },
  );

/** Popular upcoming events (the organizers' public review counts). */
export const cachedPopular = () =>
  publicCached(
    'marketplace',
    ['popular'],
    async () => popularListings(await requireIndex()),
    (raw) => reviveItems(raw as Raw[]),
  );

/** Cities with a geo centre (the "near" options). */
export const cachedCityCenters = () =>
  publicCached(
    'marketplace',
    ['city-centers'],
    () => cityCenters(),
    (raw) => raw as { city: string; lat: number; lng: number }[],
  );

/** M6.14b: promoted placements matching a search (flagged; empty when off or past page 1). */
export const cachedPromoted = (p: SearchV2Params) =>
  publicCached(
    'marketplace',
    ['promoted', p],
    async () =>
      promotedPlacementsEnabled()
        ? promotedPlacements(await requireIndex(), p, new Date(), { enabled: true })
        : [],
    (raw) => reviveItems(raw as Raw[]),
  );
