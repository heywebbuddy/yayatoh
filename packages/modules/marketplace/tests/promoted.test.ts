import { describe, expect, it } from 'vitest';
import { promotedPlacementsEnabled, promotionState } from '../src/commands/promotions.ts';
import { type IndexableListing, toSearchDocument } from '../src/search/document.ts';
import { meilisearchIndex, toMeiliFilter } from '../src/search/meilisearch.ts';
import { fakeMeilisearch } from '../src/search/meilisearch-fake.ts';

const ORG = '01900000-0000-7000-8000-000000000001';
const listing = (slug: string, name: string, i: number): IndexableListing => ({
  orgId: ORG,
  eventId: `01900000-0000-7000-8000-00000000000${i}`,
  slug,
  name,
  tagline: null,
  category: 'music',
  profile: 'concert',
  venueName: null,
  city: 'Paris',
  country: 'FR',
  orgSlug: 'harbor-arts',
  orgName: 'Harbor Arts',
  currency: 'EUR',
  minPriceMinor: 0,
  maxPriceMinor: 0,
  startsAt: new Date('2031-05-01T18:00:00Z'),
  endsAt: new Date('2031-05-01T22:00:00Z'),
  popularity: 0,
  latitude: null,
  longitude: null,
  onMarketplace: true,
});

describe('promoted placements (M6.14b)', () => {
  it('the `in` filter renders as Meilisearch IN and is bounded', () => {
    expect(toMeiliFilter([{ field: 'slug', in: ['a-b', 'c"d'] }])).toEqual(['slug IN ["a-b", "c\\"d"]']);
    expect(() => toMeiliFilter([{ field: 'slug', in: [] }])).toThrow();
    expect(() =>
      toMeiliFilter([{ field: 'slug', in: Array.from({ length: 501 }, (_, i) => `s${i}`) }]),
    ).toThrow();
  });

  it('the fake applies IN together with the text query', async () => {
    const fake = fakeMeilisearch();
    const ix = meilisearchIndex({ ...fake.config, fetch: fake.fetch, inMemory: true });
    await ix.setup();
    const docs = [
      listing('jazz-night', 'Jazz Night', 1),
      listing('jazz-brunch', 'Jazz Brunch', 2),
      listing('opera', 'Opera Gala', 3),
    ];
    await ix.upsert(docs.map((d) => toSearchDocument(d)).filter((d) => d !== null));
    const [r] = await ix.search([
      { text: 'jazz', filters: [{ field: 'slug', in: ['jazz-brunch', 'opera'] }], page: 1, hitsPerPage: 2 },
    ]);
    expect(r?.hits.map((h) => h.doc.slug)).toEqual(['jazz-brunch']);
  });

  it('states and the flag', () => {
    const now = new Date('2030-01-10T00:00:00Z');
    const at = (d: string) => new Date(`2030-01-${d}T00:00:00Z`);
    expect(promotionState(undefined, now)).toBe('none');
    expect(promotionState({ startsAt: at('09'), endsAt: at('12'), endedAt: null }, now)).toBe('active');
    expect(promotionState({ startsAt: at('11'), endsAt: at('12'), endedAt: null }, now)).toBe('scheduled');
    expect(promotionState({ startsAt: at('01'), endsAt: at('09'), endedAt: null }, now)).toBe('ended');
    expect(promotionState({ startsAt: at('09'), endsAt: at('12'), endedAt: at('09') }, now)).toBe('ended');
    expect(promotedPlacementsEnabled({ YAYATOH_DEV_AUTH: '1' })).toBe(true);
    expect(promotedPlacementsEnabled({ NODE_ENV: 'production' })).toBe(false);
  });
});
