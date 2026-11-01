import { parseSearchParams } from '@yayatoh/marketplace';
import { describe, expect, it } from 'vitest';
import {
  CURATED_PLACES,
  countryName,
  distanceKm,
  filterGroups,
  fold,
  groupPlaces,
  locateBlocker,
  locateProblem,
  mergePlaces,
  NEAREST_MAX_KM,
  nearestPlace,
  type Place,
  placeLabel,
} from '../src/lib/places.ts';

const place = (
  city: string,
  country: string,
  lat: number | null = null,
  lng: number | null = null,
): Place => ({
  city,
  country,
  lat,
  lng,
});

describe('merging event places with the curated list', () => {
  it('keeps event places (flagged live) and adds the curated cities that are missing', () => {
    const merged = mergePlaces([place('Paris', 'FR', 48.9, 2.4)]);
    const paris = merged.filter((p) => p.city === 'Paris');
    expect(paris).toHaveLength(1);
    expect(paris[0]).toMatchObject({ live: true, lat: 48.9 });
    expect(merged.some((p) => p.city === 'Tokyo' && !p.live)).toBe(true);
    expect(merged.length).toBe(CURATED_PLACES.length);
  });

  it('gives an event city without a country the curated city of the same name (accents ignored)', () => {
    const merged = mergePlaces([place('sao paulo', '')]);
    const sp = merged.find((p) => p.live);
    expect(sp).toMatchObject({ country: 'BR' });
    expect(merged.filter((p) => fold(p.city) === 'sao paulo')).toHaveLength(1);
  });

  it('keeps a small town no curated list has, under its own country', () => {
    const merged = mergePlaces([place('Bruges', 'BE', 51.2, 3.22)]);
    expect(merged.find((p) => p.city === 'Bruges')).toMatchObject({ live: true, country: 'BE' });
  });

  it('is never empty: with no events it is the curated list', () => {
    expect(mergePlaces([]).length).toBeGreaterThan(50);
  });
});

describe('grouping and filtering', () => {
  const groups = groupPlaces(mergePlaces([place('Bruges', 'BE'), place('Nowhere', '')]), 'en');

  it('groups by country name in the locale, cities A to Z, unknown country last', () => {
    const names = groups.map((g) => g.name);
    expect(names.slice(0, 3)).toEqual(['Argentina', 'Australia', 'Austria']);
    expect(groups.at(-1)?.country).toBe('');
    const be = groups.find((g) => g.country === 'BE');
    expect(be?.cities.map((c) => c.city)).toEqual(['Brussels', 'Bruges'].sort());
  });

  it('names countries in the visitor’s language', () => {
    expect(countryName('DE', 'de')).toBe('Deutschland');
    expect(countryName('DE', 'fr')).toBe('Allemagne');
    expect(countryName('', 'en')).toBe('');
    expect(groupPlaces(CURATED_PLACES, 'de').some((g) => g.name === 'Deutschland')).toBe(true);
  });

  it('narrows to a typed city, ignoring case and accents', () => {
    const out = filterGroups(groups, 'SAO');
    expect(out).toHaveLength(1);
    expect(out[0]?.cities.map((c) => c.city)).toEqual(['São Paulo']);
  });

  it('keeps every city of a country that matches the typed name', () => {
    const out = filterGroups(groups, 'germ');
    expect(out).toHaveLength(1);
    expect(out[0]?.country).toBe('DE');
    expect(out[0]?.cities.length).toBeGreaterThan(2);
  });

  it('matches a country code and returns nothing for gibberish', () => {
    expect(filterGroups(groups, 'fr')[0]?.country).toBe('FR');
    expect(filterGroups(groups, 'zzzzqq')).toEqual([]);
    expect(filterGroups(groups, '  ')).toHaveLength(groups.length);
  });

  it('labels a place with its country', () => {
    expect(placeLabel(place('Paris', 'FR'), 'en')).toBe('Paris, France');
    expect(placeLabel(place('Paris', ''), 'en')).toBe('Paris');
  });
});

describe('the nearest city for "Use my location"', () => {
  const places = mergePlaces([]);

  it('finds the closest known city', () => {
    expect(nearestPlace(48.85, 2.35, places)?.place.city).toBe('Paris');
    expect(nearestPlace(40.75, -73.99, places)?.place.city).toBe('New York');
    // Versailles is a few km from Paris
    const v = nearestPlace(48.805, 2.12, places);
    expect(v?.place.city).toBe('Paris');
    expect(v?.km).toBeLessThan(NEAREST_MAX_KM);
  });

  it('reports a large distance in the middle of nowhere so the caller can use coordinates', () => {
    const ocean = nearestPlace(-40, -120, places);
    expect(ocean?.km).toBeGreaterThan(NEAREST_MAX_KM);
  });

  it('skips places without a location and returns null when none has one', () => {
    expect(nearestPlace(1, 1, [place('Nowhere', 'XX')])).toBeNull();
    expect(nearestPlace(1, 1, [])).toBeNull();
  });

  it('measures distance in kilometres', () => {
    expect(Math.round(distanceKm(48.86, 2.35, 51.51, -0.13))).toBeGreaterThan(330);
    expect(Math.round(distanceKm(48.86, 2.35, 51.51, -0.13))).toBeLessThan(350);
    expect(distanceKm(10, 10, 10, 10)).toBe(0);
  });
});

describe('geolocation problems', () => {
  it('maps the browser error codes', () => {
    expect(locateProblem(1)).toBe('denied');
    expect(locateProblem(2)).toBe('unavailable');
    expect(locateProblem(3)).toBe('timeout');
    expect(locateProblem(99)).toBe('unavailable');
  });

  it('names an insecure page or a missing API before asking', () => {
    expect(locateBlocker({ isSecureContext: false, hasGeolocation: true })).toBe('insecure');
    expect(locateBlocker({ isSecureContext: true, hasGeolocation: false })).toBe('unsupported');
    expect(locateBlocker({ isSecureContext: true, hasGeolocation: true })).toBeNull();
  });
});

describe('the events list reads a place from the address', () => {
  it('takes a country code (upper-cased) and a coordinate pair', () => {
    expect(parseSearchParams({ country: 'fr', lat: '48.86', lng: '2.35' })).toMatchObject({
      country: 'FR',
      lat: 48.86,
      lng: 2.35,
    });
  });

  it('drops a bad country, out-of-range or lone coordinates', () => {
    const bad = parseSearchParams({ country: 'France', lat: '95', lng: '2' });
    expect(bad.country).toBeUndefined();
    expect(bad.lat).toBeUndefined();
    expect(bad.lng).toBeUndefined();
    const lone = parseSearchParams({ lat: '48.86' });
    expect(lone.lat).toBeUndefined();
    expect(parseSearchParams({ lat: '', lng: '' }).lat).toBeUndefined();
  });
});
