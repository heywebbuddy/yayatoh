import type { SearchDocument } from './document.ts';

/** Fields a query may filter on (each must be a filterable attribute of the index). */
export const FILTER_FIELDS = [
  'category',
  'city',
  'priceBand',
  'slug',
  'orgSlug',
  'startsAt',
  'endsAt',
] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];
/** Fields the search returns counts for. */
export const FACET_FIELDS = ['category', 'city', 'priceBand'] as const;
export type FacetField = (typeof FACET_FIELDS)[number];
/** Fields results may be sorted by (besides distance). */
export const SORT_FIELDS = ['startsAt', 'popularity'] as const;
export type SortField = (typeof SORT_FIELDS)[number];
/** Fields full-text search looks in, most important first. */
export const SEARCHABLE_FIELDS = ['name', 'tagline', 'orgName', 'venueName', 'city'] as const;

/** The most values an `in` filter carries. */
export const MAX_IN_VALUES = 500;

export type Filter =
  | { readonly field: Exclude<FilterField, 'startsAt' | 'endsAt'>; readonly eq: string }
  | { readonly field: Exclude<FilterField, 'startsAt' | 'endsAt'>; readonly ne: string }
  /** M6.14b: the value is one of these (at most `MAX_IN_VALUES`). */
  | { readonly field: Exclude<FilterField, 'startsAt' | 'endsAt'>; readonly in: readonly string[] }
  | { readonly field: 'startsAt' | 'endsAt'; readonly gte?: number; readonly lt?: number }
  | { readonly geo: { readonly lat: number; readonly lng: number; readonly radiusM: number } };

export type Sort =
  | { readonly field: SortField; readonly dir: 'asc' | 'desc' }
  | { readonly nearest: { readonly lat: number; readonly lng: number } };

export interface SearchQuery {
  readonly text?: string;
  /** All must hold. */
  readonly filters: readonly Filter[];
  readonly facets?: readonly FacetField[];
  readonly sort?: readonly Sort[];
  /** 1-based page and its size (exact totals). `hitsPerPage: 0` counts only. */
  readonly page: number;
  readonly hitsPerPage: number;
}

export interface SearchHit {
  readonly doc: SearchDocument;
  /** Metres from the `nearest` sort point, when the query sorted by distance. */
  readonly distanceM: number | null;
}

export interface SearchHits {
  readonly hits: readonly SearchHit[];
  readonly total: number;
  readonly facets: Readonly<Partial<Record<FacetField, Readonly<Record<string, number>>>>>;
}

/**
 * The marketplace search index (M6.14a, decision P6-11): Meilisearch in production, the
 * in-memory Meilisearch fake in dev and CI. Fed only from the public read model (the
 * `marketplace.search-index` subscriber); it never holds anything that is not on a public listing.
 */
export interface SearchIndex {
  readonly name: 'meilisearch';
  /** The fake is per process (dev, CI): the web app loads it from the read model on first use. */
  readonly inMemory: boolean;
  /** Create the index and apply its settings (filterable, sortable, searchable attributes). */
  setup(): Promise<void>;
  upsert(docs: readonly SearchDocument[]): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  /** Drop every document (a full reindex follows). */
  clear(): Promise<void>;
  /** Several queries in one round trip, answers in order. */
  search(queries: readonly SearchQuery[]): Promise<SearchHits[]>;
}
