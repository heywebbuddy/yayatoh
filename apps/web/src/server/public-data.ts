import 'server-only';
import {
  type ListingDto,
  type ListingPageDto,
  listingCities,
  orgListings,
  type SearchParams,
  searchListings,
} from '@yayatoh/marketplace';
import { type PublicReviewSummaryDto, publicReviews } from '@yayatoh/reviews';
import { publicCached } from './public-cache.ts';

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
