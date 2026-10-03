// M6.14a: marketplace search v2 (SearchIndex port, Meilisearch + fake), recommendations, moderation.
export {
  MODERATION_REASON_MAX,
  MODERATION_STATES,
  ModerationItemDto,
  type ModerationState,
  moderateListingCommand,
  moderationQueueTx,
} from './commands/moderation.ts';
// M6.14b: promoted placements in search (flagged; priced later, nothing charged).
export {
  endPromotionCommand,
  PROMOTION_STATES,
  PromotableListingDto,
  type PromotionState,
  promotedPlacementsEnabled,
  promoteListingCommand,
  promotionState,
  promotionsQuery,
} from './commands/promotions.ts';
export { addLegacyRedirectCommand, LegacyRedirectDto, LegacyRedirectInput } from './commands/redirects.ts';
export { siteSettingsQuery, updateSiteSettingsCommand } from './commands/settings.ts';
export { frameAncestors, MAX_EMBED_ORIGINS, normalizeOrigin } from './domain/embed.ts';
export { canonicalHostFor, isListable, isOnMarketplace, type ListingSource } from './domain/listing.ts';
export {
  followRedirectChain,
  MAX_REDIRECT_HOPS,
  normalizePath,
  pickRedirect,
  type RedirectRule,
  redirectLocation,
} from './domain/redirects.ts';
export {
  CATEGORIES,
  dayRange,
  escapeLike,
  PAGE_SIZE,
  PRICE_FILTERS,
  pageCount,
  parseSearchParams,
  SearchParams,
} from './domain/search.ts';
export * from './dto.ts';
export { privateColumns } from './private-columns.ts';
export {
  catchUpListings,
  EVENT_LISTING_EVENTS,
  isHiddenTx,
  LISTING_CHANGED,
  LISTING_CHANGED_EVENTS,
  listingsProjector,
  ORG_LISTING_EVENTS,
} from './projector.ts';
export {
  listingBySlug,
  listingCities,
  matchLegacyRedirect,
  orgListings,
  type PublicOrganizer,
  publicOrganizer,
  publicOrganizerById,
  publicSiteSettings,
  searchListings,
  sitemapListings,
  widgetOrigins,
} from './queries.ts';
export { LISTED_STATUSES, MAX_PROMOTION_DAYS, REDIRECT_MATCHES, REDIRECT_STATUSES } from './schema.ts';
export {
  docIdFor,
  INDEXED_FIELDS,
  type IndexableListing,
  isIndexable,
  PRICE_BANDS,
  type PriceBand,
  priceBand,
  roundCoord,
  SearchDocument,
  toSearchDocument,
} from './search/document.ts';
export {
  catchUpSearchIndex,
  reindexAll,
  SEARCH_INDEXER,
  searchIndexer,
  syncListingTx,
} from './search/indexer.ts';
export {
  DEFAULT_INDEX,
  filterValue,
  INDEX_SETTINGS,
  type MeilisearchConfig,
  MeilisearchError,
  meilisearchIndex,
  toMeiliFilter,
  toMeiliQuery,
  toMeiliSort,
} from './search/meilisearch.ts';
export {
  type FakeMeilisearch,
  type FakeMeilisearchCall,
  fakeMeilisearch,
  geoDistanceM,
} from './search/meilisearch-fake.ts';
export {
  DEFAULT_RADIUS_KM,
  hasFilters,
  PRICE_FILTER_BANDS,
  parseSearchV2Params,
  RADII_KM,
  SEARCH_PAGE_SIZE,
  SEARCH_SORTS,
  type SearchSort,
  SearchV2Params,
  WHEN_PRESETS,
  type WhenPreset,
  whenWindow,
} from './search/params.ts';
export {
  FACET_FIELDS,
  type FacetField,
  FILTER_FIELDS,
  type Filter,
  SEARCHABLE_FIELDS,
  type SearchHit,
  type SearchHits,
  type SearchIndex,
  type SearchQuery,
  SORT_FIELDS,
  type Sort,
} from './search/port.ts';
export { PROMOTED_SLOTS, promotedPlacements, promotedSlugs } from './search/promoted.ts';
export {
  cityCenters,
  type GeoPoint,
  listingsBySlugs,
  NEARBY_RADIUS_KM,
  nearbyListings,
  popularListings,
  RECOMMENDATIONS,
  resolveCenter,
  SearchListingDto,
  SearchResultDto,
  SimilarDto,
  searchMarketplace,
  similarListings,
} from './search/query.ts';
export {
  configuredSearchIndex,
  devFakeMeilisearch,
  searchIndexFromEnv,
} from './search/select.ts';
