import { describe, expect, it } from 'vitest';
import { searchSubscribers } from '../src/registry.ts';

describe('marketplace search indexer registration (M6.14a)', () => {
  const noop = async () => {};
  it('runs only for a real Meilisearch (the dev/CI fake belongs to the web process)', () => {
    expect(searchSubscribers({ NODE_ENV: 'development' }, noop)).toEqual([]);
    expect(searchSubscribers({ NODE_ENV: 'production' }, noop)).toEqual([]);
    const subs = searchSubscribers(
      {
        NODE_ENV: 'production',
        MEILISEARCH_URL: 'https://ms.example.invalid',
        MEILISEARCH_ADMIN_KEY: 'a',
        MEILISEARCH_SEARCH_KEY: 's',
      },
      noop,
    );
    expect(subs.map((s) => s.name)).toEqual(['marketplace.search-index']);
    expect(subs[0]?.events).toEqual(['marketplace.listing_changed@1']);
  });
});
