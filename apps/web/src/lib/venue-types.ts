/** Kinds of venue (mirrors `VENUE_TYPES` in @yayatoh/venues, which has database code a browser bundle must not import). */
export const VENUE_TYPES = [
  'lounge',
  'ballroom',
  'conference_centre',
  'outdoor',
  'restaurant',
  'hotel',
  'other',
] as const;
export type VenueType = (typeof VENUE_TYPES)[number];
