/**
 * The places behind the home finder's "Where" field: the cities and countries our events are in
 * (from the database), a curated list of well-known cities so the list is never empty, helpers to
 * group, filter and name them, and the nearest-city lookup for "Use my location" (no geocoding API).
 */

export interface Place {
  readonly city: string;
  /** ISO 3166-1 alpha-2 (upper case), or '' when unknown. */
  readonly country: string;
  readonly lat: number | null;
  readonly lng: number | null;
  /** Has upcoming events on the platform right now. */
  readonly live?: boolean;
}

export interface PlaceGroup {
  readonly country: string;
  /** The country's name in the visitor's language ('' country → the "Other" bucket's label is the caller's). */
  readonly name: string;
  readonly cities: readonly Place[];
}

/** [city, country, lat, lng]: major event cities, so the list covers the world before the first listing. */
const CURATED: readonly (readonly [string, string, number, number])[] = [
  ['Sydney', 'AU', -33.87, 151.21],
  ['Melbourne', 'AU', -37.81, 144.96],
  ['Vienna', 'AT', 48.21, 16.37],
  ['Brussels', 'BE', 50.85, 4.35],
  ['São Paulo', 'BR', -23.55, -46.63],
  ['Rio de Janeiro', 'BR', -22.91, -43.17],
  ['Toronto', 'CA', 43.65, -79.38],
  ['Vancouver', 'CA', 49.28, -123.12],
  ['Montreal', 'CA', 45.5, -73.57],
  ['Beijing', 'CN', 39.9, 116.4],
  ['Shanghai', 'CN', 31.23, 121.47],
  ['Copenhagen', 'DK', 55.68, 12.57],
  ['Cairo', 'EG', 30.04, 31.24],
  ['Helsinki', 'FI', 60.17, 24.94],
  ['Paris', 'FR', 48.86, 2.35],
  ['Lyon', 'FR', 45.76, 4.84],
  ['Berlin', 'DE', 52.52, 13.4],
  ['Munich', 'DE', 48.14, 11.58],
  ['Hamburg', 'DE', 53.55, 9.99],
  ['Athens', 'GR', 37.98, 23.73],
  ['Hong Kong', 'HK', 22.32, 114.17],
  ['Budapest', 'HU', 47.5, 19.04],
  ['Mumbai', 'IN', 19.08, 72.88],
  ['Delhi', 'IN', 28.61, 77.21],
  ['Bengaluru', 'IN', 12.97, 77.59],
  ['Hyderabad', 'IN', 17.39, 78.49],
  ['Chennai', 'IN', 13.08, 80.27],
  ['Kolkata', 'IN', 22.57, 88.36],
  ['Jakarta', 'ID', -6.21, 106.85],
  ['Dublin', 'IE', 53.35, -6.26],
  ['Tel Aviv', 'IL', 32.09, 34.78],
  ['Rome', 'IT', 41.9, 12.5],
  ['Milan', 'IT', 45.46, 9.19],
  ['Tokyo', 'JP', 35.68, 139.69],
  ['Osaka', 'JP', 34.69, 135.5],
  ['Nairobi', 'KE', -1.29, 36.82],
  ['Kuala Lumpur', 'MY', 3.14, 101.69],
  ['Mexico City', 'MX', 19.43, -99.13],
  ['Amsterdam', 'NL', 52.37, 4.9],
  ['Rotterdam', 'NL', 51.92, 4.48],
  ['Auckland', 'NZ', -36.85, 174.76],
  ['Lagos', 'NG', 6.52, 3.38],
  ['Oslo', 'NO', 59.91, 10.75],
  ['Karachi', 'PK', 24.86, 67.0],
  ['Manila', 'PH', 14.6, 120.98],
  ['Warsaw', 'PL', 52.23, 21.01],
  ['Lisbon', 'PT', 38.72, -9.14],
  ['Porto', 'PT', 41.15, -8.61],
  ['Doha', 'QA', 25.29, 51.53],
  ['Moscow', 'RU', 55.76, 37.62],
  ['Riyadh', 'SA', 24.71, 46.68],
  ['Singapore', 'SG', 1.35, 103.82],
  ['Johannesburg', 'ZA', -26.2, 28.05],
  ['Cape Town', 'ZA', -33.92, 18.42],
  ['Seoul', 'KR', 37.57, 126.98],
  ['Madrid', 'ES', 40.42, -3.7],
  ['Barcelona', 'ES', 41.39, 2.17],
  ['Stockholm', 'SE', 59.33, 18.07],
  ['Zurich', 'CH', 47.38, 8.54],
  ['Geneva', 'CH', 46.2, 6.14],
  ['Taipei', 'TW', 25.03, 121.57],
  ['Bangkok', 'TH', 13.76, 100.5],
  ['Istanbul', 'TR', 41.01, 28.98],
  ['Dubai', 'AE', 25.2, 55.27],
  ['Abu Dhabi', 'AE', 24.45, 54.38],
  ['London', 'GB', 51.51, -0.13],
  ['Manchester', 'GB', 53.48, -2.24],
  ['Edinburgh', 'GB', 55.95, -3.19],
  ['New York', 'US', 40.71, -74.01],
  ['Los Angeles', 'US', 34.05, -118.24],
  ['Chicago', 'US', 41.88, -87.63],
  ['San Francisco', 'US', 37.77, -122.42],
  ['Austin', 'US', 30.27, -97.74],
  ['Miami', 'US', 25.76, -80.19],
  ['Las Vegas', 'US', 36.17, -115.14],
  ['Seattle', 'US', 47.61, -122.33],
  ['Boston', 'US', 42.36, -71.06],
  ['Buenos Aires', 'AR', -34.6, -58.38],
  ['Bogotá', 'CO', 4.71, -74.07],
  ['Santiago', 'CL', -33.45, -70.67],
];

export const CURATED_PLACES: readonly Place[] = CURATED.map(([city, country, lat, lng]) => ({
  city,
  country,
  lat,
  lng,
}));

const key = (p: Pick<Place, 'city' | 'country'>) => `${fold(p.city)}|${p.country}`;

/** Lower-case without accents, so "sao paulo" finds "São Paulo". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/**
 * Event places first (they have events, so they carry `live`), then the curated cities that are not
 * already there. An event city without a country joins the curated city of the same name.
 */
export function mergePlaces(
  fromEvents: readonly Place[],
  curated: readonly Place[] = CURATED_PLACES,
): Place[] {
  const out = new Map<string, Place>();
  const byName = new Map(curated.map((c) => [fold(c.city), c]));
  for (const p of fromEvents) {
    const match = p.country === '' ? byName.get(fold(p.city)) : undefined;
    const merged: Place = {
      ...p,
      country: p.country || match?.country || '',
      lat: p.lat ?? match?.lat ?? null,
      lng: p.lng ?? match?.lng ?? null,
      live: true,
    };
    out.set(key(merged), merged);
  }
  for (const c of curated) if (!out.has(key(c))) out.set(key(c), c);
  return [...out.values()];
}

/** The country's name in the locale, or its code when the runtime does not know it. */
export function countryName(code: string, locale: string): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Places grouped by country (A to Z in the locale), cities A to Z under each; unknown country last. */
export function groupPlaces(places: readonly Place[], locale: string): PlaceGroup[] {
  const collator = new Intl.Collator(locale);
  const byCountry = new Map<string, Place[]>();
  for (const p of places) byCountry.set(p.country, [...(byCountry.get(p.country) ?? []), p]);
  return [...byCountry.entries()]
    .map(([country, cities]) => ({
      country,
      name: countryName(country, locale),
      cities: [...cities].sort((a, b) => collator.compare(a.city, b.city)),
    }))
    .sort((a, b) => (a.country === '' ? 1 : b.country === '' ? -1 : collator.compare(a.name, b.name)));
}

/** Groups narrowed to what the visitor typed: a country match keeps all its cities. */
export function filterGroups(groups: readonly PlaceGroup[], query: string): PlaceGroup[] {
  const q = fold(query.trim());
  if (!q) return [...groups];
  return groups.flatMap((g) => {
    if (g.name && (fold(g.name).includes(q) || g.country.toLowerCase() === q)) return [g];
    const cities = g.cities.filter((c) => fold(c.city).includes(q));
    return cities.length > 0 ? [{ ...g, cities }] : [];
  });
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (n: number) => (n * Math.PI) / 180;
  const h =
    Math.sin(r(bLat - aLat) / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Beyond this the nearest known city is not "your" city: the search uses the coordinates instead. */
export const NEAREST_MAX_KM = 120;

/** The known place closest to a point, with how far it is; null when no place has a location. */
export function nearestPlace(
  lat: number,
  lng: number,
  places: readonly Place[],
): { place: Place; km: number } | null {
  let best: { place: Place; km: number } | null = null;
  for (const place of places) {
    if (place.lat === null || place.lng === null) continue;
    const km = distanceKm(lat, lng, place.lat, place.lng);
    if (!best || km < best.km) best = { place, km };
  }
  return best;
}

export type LocateProblem = 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout';

/** The geolocation failure to tell the visitor about (`code` is a GeolocationPositionError code). */
export function locateProblem(code: number): LocateProblem {
  return code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable';
}

/** Browsers only hand out a position on HTTPS (or localhost); say so rather than failing silently. */
export function locateBlocker(env: {
  isSecureContext: boolean;
  hasGeolocation: boolean;
}): LocateProblem | null {
  if (!env.isSecureContext) return 'insecure';
  return env.hasGeolocation ? null : 'unsupported';
}

/** Coordinates go into the address rounded to about 1 km. */
export const roundCoord = (n: number) => n.toFixed(2);

/** "Paris, France" style label of a place. */
export function placeLabel(p: Pick<Place, 'city' | 'country'>, locale: string): string {
  const c = countryName(p.country, locale);
  return c ? `${p.city}, ${c}` : p.city;
}
