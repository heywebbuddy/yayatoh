import { describe, expect, it } from 'vitest';
import {
  docIdFor,
  INDEXED_FIELDS,
  type IndexableListing,
  isIndexable,
  priceBand,
  roundCoord,
  SearchDocument,
  toSearchDocument,
} from '../src/search/document.ts';
import { filterValue, meilisearchIndex, toMeiliFilter, toMeiliSort } from '../src/search/meilisearch.ts';
import { fakeMeilisearch, geoDistanceM } from '../src/search/meilisearch-fake.ts';
import { hasFilters, parseSearchV2Params, whenWindow } from '../src/search/params.ts';
import { resolveCenter } from '../src/search/query.ts';
import { configuredSearchIndex, searchIndexFromEnv } from '../src/search/select.ts';

const ORG = '01900000-0000-7000-8000-000000000001';
const row = (over: Partial<IndexableListing> = {}): IndexableListing => ({
  orgId: ORG,
  eventId: '01900000-0000-7000-8000-00000000000a',
  slug: 'spring-concert',
  name: 'Spring Concert',
  tagline: 'Strings by the harbour',
  category: 'music',
  profile: 'concert',
  venueName: 'Harbor Hall',
  city: 'Paris',
  country: 'FR',
  orgSlug: 'harbor-arts',
  orgName: 'Harbor Arts',
  currency: 'EUR',
  minPriceMinor: 1200,
  maxPriceMinor: 3000,
  startsAt: new Date('2031-05-01T18:00:00Z'),
  endsAt: new Date('2031-05-01T22:00:00Z'),
  popularity: 3,
  latitude: 48.857,
  longitude: 2.352,
  onMarketplace: true,
  ...over,
});

const PARIS = { lat: 48.857, lng: 2.352 };
const LYON = { lat: 45.764, lng: 4.836 };
const VERSAILLES = { lat: 48.805, lng: 2.12 };

function index() {
  const fake = fakeMeilisearch();
  return { fake, ix: meilisearchIndex({ ...fake.config, fetch: fake.fetch, inMemory: true }) };
}

describe('search documents (M6.14a)', () => {
  it('are built from allowlisted public fields only, with an opaque stable id', () => {
    const doc = toSearchDocument(row());
    expect(doc).not.toBeNull();
    expect(Object.keys(doc ?? {}).sort()).toEqual(Object.keys(SearchDocument.shape).sort());
    expect(Object.keys(INDEXED_FIELDS).sort()).toEqual(Object.keys(SearchDocument.shape).sort());
    expect(doc?.id).toBe(docIdFor(ORG, row().eventId));
    expect(doc?.id).not.toContain(ORG.slice(0, 8));
    expect(JSON.stringify(doc)).not.toContain(row().eventId);
    expect(doc?._geo).toEqual({ lat: 48.857, lng: 2.352 });
    expect(doc?.startsAt).toBe(Date.parse('2031-05-01T18:00:00Z') / 1000);
    // A renamed event keeps its document.
    expect(toSearchDocument(row({ slug: 'renamed', name: 'Renamed' }))?.id).toBe(doc?.id);
  });

  it('never index weddings or listings off the marketplace (D13), even when mis-flagged', () => {
    expect(isIndexable(row())).toBe(true);
    expect(toSearchDocument(row({ profile: 'wedding' }))).toBeNull();
    expect(toSearchDocument(row({ onMarketplace: false }))).toBeNull();
  });

  it('refuse fields outside the allowlist', () => {
    const doc = toSearchDocument(row());
    expect(SearchDocument.safeParse({ ...doc, orgId: ORG }).success).toBe(false);
    expect(SearchDocument.safeParse({ ...doc, buyerEmail: 'x@example.test' }).success).toBe(false);
  });

  it('band prices in the listing currency', () => {
    expect(priceBand(null, null, 'EUR')).toBe('unpriced');
    expect(priceBand(0, 0, 'EUR')).toBe('free');
    expect(priceBand(0, 1500, 'EUR')).toBe('under_25');
    expect(priceBand(2500, 9000, 'USD')).toBe('from_25_to_100');
    expect(priceBand(10_000, 10_000, 'USD')).toBe('from_25_to_100');
    expect(priceBand(10_001, 20_000, 'USD')).toBe('over_100');
    expect(priceBand(3000, 3000, 'JPY')).toBe('over_100');
    expect(roundCoord(48.856_613)).toBe(48.857);
  });
});

describe('Meilisearch adapter against the fake', () => {
  it('quotes filter values and builds geo filters and sorts', () => {
    expect(filterValue('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"');
    expect(() => filterValue(Number.NaN)).toThrow();
    expect(
      toMeiliFilter([
        { field: 'city', eq: 'Paris' },
        { field: 'slug', ne: 'x' },
        { field: 'startsAt', gte: 1, lt: 9 },
        { geo: { lat: 1.5, lng: -2, radiusM: 2500.4 } },
      ]),
    ).toEqual([
      'city = "Paris"',
      'slug != "x"',
      'startsAt >= 1',
      'startsAt < 9',
      '_geoRadius(1.5, -2, 2500)',
    ]);
    expect(toMeiliSort([{ nearest: { lat: 1, lng: 2 } }, { field: 'popularity', dir: 'desc' }])).toEqual([
      '_geoPoint(1, 2):asc',
      'popularity:desc',
    ]);
  });

  it('indexes, filters, facets, geo-sorts, pages and removes', async () => {
    const { fake, ix } = index();
    await ix.setup();
    await ix.setup(); // idempotent
    const docs = [
      toSearchDocument(row()),
      toSearchDocument(
        row({
          eventId: '01900000-0000-7000-8000-00000000000b',
          slug: 'lyon-jazz',
          name: 'Lyon Jazz',
          city: 'Lyon',
          latitude: LYON.lat,
          longitude: LYON.lng,
          popularity: 9,
        }),
      ),
      toSearchDocument(
        row({
          eventId: '01900000-0000-7000-8000-00000000000c',
          slug: 'versailles-gala',
          name: 'Versailles Gala',
          category: 'charity',
          city: 'Versailles',
          latitude: VERSAILLES.lat,
          longitude: VERSAILLES.lng,
          minPriceMinor: 0,
          maxPriceMinor: 0,
        }),
      ),
      toSearchDocument(
        row({
          eventId: '01900000-0000-7000-8000-00000000000d',
          slug: 'online-talk',
          name: 'Online Talk',
          city: null,
          latitude: null,
          longitude: null,
          category: 'technology',
          startsAt: new Date('2031-04-01T10:00:00Z'),
        }),
      ),
    ].flatMap((d) => (d ? [d] : []));
    await ix.upsert(docs);
    expect(fake.documents.size).toBe(4);
    // Online events carry no location at all.
    expect('_geo' in (fake.documents.get(docs[3]?.id ?? '') ?? {})).toBe(false);

    const [all, music, near, text, facets, page2] = await ix.search([
      { filters: [], sort: [{ field: 'startsAt', dir: 'asc' }], page: 1, hitsPerPage: 10 },
      { filters: [{ field: 'category', eq: 'music' }], page: 1, hitsPerPage: 10 },
      {
        filters: [{ geo: { ...PARIS, radiusM: 50_000 } }],
        sort: [{ nearest: PARIS }],
        page: 1,
        hitsPerPage: 10,
      },
      { text: 'jaz', filters: [], page: 1, hitsPerPage: 10 },
      { filters: [], facets: ['category', 'city', 'priceBand'], page: 1, hitsPerPage: 0 },
      { filters: [], sort: [{ field: 'startsAt', dir: 'asc' }], page: 2, hitsPerPage: 3 },
    ]);
    expect(all?.hits.map((h) => h.doc.slug)[0]).toBe('online-talk');
    expect(all?.total).toBe(4);
    expect(music?.hits.map((h) => h.doc.slug).sort()).toEqual(['lyon-jazz', 'spring-concert']);
    expect(near?.hits.map((h) => h.doc.slug)).toEqual(['spring-concert', 'versailles-gala']);
    expect(near?.hits[0]?.distanceM).toBe(0);
    expect(near?.hits[1]?.distanceM).toBeGreaterThan(15_000);
    expect(text?.hits.map((h) => h.doc.slug)).toEqual(['lyon-jazz']);
    expect(facets?.hits).toEqual([]);
    expect(facets?.facets.category).toEqual({ music: 2, charity: 1, technology: 1 });
    expect(facets?.facets.priceBand).toEqual({ under_25: 3, free: 1 });
    expect(facets?.facets.city).toEqual({ Paris: 1, Lyon: 1, Versailles: 1 });
    expect(page2?.hits).toHaveLength(1);

    await ix.remove([docs[0]?.id ?? '']);
    const [after] = await ix.search([{ filters: [], page: 1, hitsPerPage: 10 }]);
    expect(after?.total).toBe(3);
    await ix.clear();
    expect(fake.documents.size).toBe(0);
    // Writes used the admin key; searches the search-only key.
    expect(fake.calls.filter((c) => c.path === '/multi-search').every((c) => c.key === 'search')).toBe(true);
    expect(fake.calls.filter((c) => c.path !== '/multi-search').every((c) => c.key === 'admin')).toBe(true);
  });

  it('the fake is strict: unknown attributes, bad keys and off-allowlist documents are refused', async () => {
    const { fake } = index();
    const call = (path: string, key: string, body: unknown, method = 'POST') =>
      fake.fetch(`${fake.config.url}${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const ix = meilisearchIndex({ ...fake.config, fetch: fake.fetch });
    await ix.setup();
    const q = (filter: string[]) => ({ queries: [{ indexUid: fake.config.index, q: '', filter }] });
    expect((await call('/multi-search', fake.config.searchKey, q(['orgId = "x"']))).status).toBe(400);
    expect((await call('/multi-search', fake.config.searchKey, q(['city = "Paris"']))).status).toBe(200);
    expect((await call('/multi-search', 'wrong', q([]))).status).toBe(403);
    // The search key cannot write.
    expect((await call(`/indexes/${fake.config.index}/documents`, fake.config.searchKey, [])).status).toBe(
      403,
    );
    const leaky = { ...toSearchDocument(row()), buyerEmail: 'a@b.test' };
    expect(
      (await call(`/indexes/${fake.config.index}/documents`, fake.config.adminKey, [leaky])).status,
    ).toBe(400);
    await expect(ix.upsert([leaky as never])).rejects.toThrow();
    expect(fake.documents.size).toBe(0);
  });

  it('measures distance like Meilisearch (haversine)', () => {
    expect(Math.round(geoDistanceM(PARIS, LYON) / 1000)).toBe(392);
  });
});

describe('search v2 parameters', () => {
  it('drop invalid values and keep valid ones', () => {
    const p = parseSearchV2Params({
      q: ' jazz ',
      category: 'music',
      price: 'free',
      when: 'week',
      radius: '25',
      near: 'Paris',
      sort: 'popular',
      page: '2',
    });
    expect(p).toMatchObject({
      q: 'jazz',
      category: 'music',
      price: 'free',
      when: 'week',
      radius: 25,
      near: 'Paris',
      sort: 'popular',
      page: 2,
    });
    const bad = parseSearchV2Params({
      category: 'gala',
      price: 'unpriced',
      when: 'year',
      radius: '7',
      lat: '99',
      like: 'Bad Slug',
      page: 'x',
    });
    expect(bad).toEqual({ page: 1 });
    expect(hasFilters(bad)).toBe(false);
    expect(hasFilters(p)).toBe(true);
    expect(parseSearchV2Params({ from: '2031-05-02', to: '2031-05-01' }).to).toBeUndefined();
  });

  it('resolve the geo centre from a city or the browser', () => {
    const centers = [{ city: 'Paris', ...PARIS }];
    expect(resolveCenter(parseSearchV2Params({ near: 'paris' }), centers)).toEqual({
      ...PARIS,
      label: 'Paris',
      radiusKm: 25,
    });
    expect(resolveCenter(parseSearchV2Params({ near: 'Atlantis' }), centers)).toBeNull();
    expect(resolveCenter(parseSearchV2Params({ near: 'me', lat: '1', lng: '2', radius: '5' }), [])).toEqual({
      lat: 1,
      lng: 2,
      label: 'me',
      radiusKm: 5,
    });
    expect(resolveCenter(parseSearchV2Params({ near: 'me' }), [])).toBeNull();
  });

  it('date presets are UTC windows', () => {
    const now = new Date('2031-05-01T22:30:00Z');
    expect(whenWindow('today', now).startsBefore).toBe(Date.parse('2031-05-02T00:00:00Z') / 1000);
    expect(whenWindow('week', now).startsBefore).toBe(Date.parse('2031-05-08T22:30:00Z') / 1000);
  });
});

describe('index selection', () => {
  it('uses the fake in dev and CI, Meilisearch with keys, and nothing in production by default', () => {
    expect(configuredSearchIndex({ NODE_ENV: 'development' })).toBe('fake');
    expect(configuredSearchIndex({ NODE_ENV: 'production', YAYATOH_DEV_AUTH: '1' })).toBe('fake');
    expect(configuredSearchIndex({ NODE_ENV: 'production' })).toBe('off');
    expect(configuredSearchIndex({ NODE_ENV: 'production', MEILISEARCH_URL: 'fake' })).toBe('off');
    expect(configuredSearchIndex({ NODE_ENV: 'production', MEILISEARCH_URL: 'https://ms.example' })).toBe(
      'off',
    );
    expect(
      configuredSearchIndex({
        NODE_ENV: 'production',
        MEILISEARCH_URL: 'https://ms.example',
        MEILISEARCH_ADMIN_KEY: 'a',
        MEILISEARCH_SEARCH_KEY: 's',
      }),
    ).toBe('meilisearch');
    expect(searchIndexFromEnv({ NODE_ENV: 'production' })).toBeNull();
    expect(searchIndexFromEnv({ NODE_ENV: 'test' })?.inMemory).toBe(true);
  });
});
