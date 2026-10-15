/** What Discover asks the search API for (M7.3c, `GET /v1/public/events`). */
import type { DateRange } from './dates';

export const PAGE_SIZE = 20;
export const NEAR_RADIUS_KM = 25;

/** The platform categories the web offers (`packages/modules/events/src/domain/categories.ts`). */
export const CATEGORIES = [
  'arts_culture',
  'business_seminars',
  'charity',
  'community',
  'education_classes',
  'family',
  'food_drink',
  'health_wellness',
  'music',
  'nightlife',
  'religion_spirituality',
  'social_gatherings',
  'sports_fitness',
  'technology',
  'travel_leisure',
  'other',
] as const;

export interface NearMe {
  readonly lat: number;
  readonly lng: number;
}

export interface DiscoverFilters {
  readonly q: string;
  readonly category: string | null;
  readonly range: DateRange;
  readonly near: NearMe | null;
}

export const NO_FILTERS: DiscoverFilters = {
  q: '',
  category: null,
  range: { from: null, to: null },
  near: null,
};

export const hasFilters = (f: DiscoverFilters): boolean =>
  f.q.trim() !== '' || f.category !== null || f.range.from !== null || f.range.to !== null || f.near !== null;

/** The query string of the search call; empty filters are left out, `cursor` continues a page. */
export function searchQuery(f: DiscoverFilters, cursor?: string) {
  const q = f.q.trim().slice(0, 100);
  return {
    limit: PAGE_SIZE,
    ...(q ? { q } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.range.from ? { from: f.range.from } : {}),
    ...(f.range.to ? { to: f.range.to } : {}),
    ...(f.near ? { lat: round(f.near.lat), lng: round(f.near.lng), radiusKm: NEAR_RADIUS_KM } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** About a kilometre of precision (two decimals): enough to sort by distance, no street-level fix leaves the phone. */
const round = (n: number) => Math.round(n * 100) / 100;
