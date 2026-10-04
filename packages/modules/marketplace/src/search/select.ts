import { type MeilisearchConfig, meilisearchIndex } from './meilisearch.ts';
import { type FakeMeilisearch, fakeMeilisearch } from './meilisearch-fake.ts';
import type { SearchIndex } from './port.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** Dev, CI and previews: dev sign-in is on, or the build is not a production one. */
const devLike = (env: Env) => env.YAYATOH_DEV_AUTH === '1' || env.NODE_ENV !== 'production';

const FAKE = Symbol.for('yayatoh.marketplace.fakeMeilisearch');

/**
 * The process's Meilisearch fake (dev and CI): one per process, shared by every route and page of
 * the web server through `globalThis` (bundles may load this module more than once).
 */
export function devFakeMeilisearch(): FakeMeilisearch {
  const g = globalThis as { [FAKE]?: FakeMeilisearch };
  g[FAKE] ??= fakeMeilisearch();
  return g[FAKE];
}

/** Which search index the environment configures (no connection made). */
export function configuredSearchIndex(env: Env = process.env): 'meilisearch' | 'fake' | 'off' {
  const url = (env.MEILISEARCH_URL ?? '').trim();
  if (url === 'fake') return devLike(env) ? 'fake' : 'off';
  if (url) return env.MEILISEARCH_ADMIN_KEY && env.MEILISEARCH_SEARCH_KEY ? 'meilisearch' : 'off';
  return devLike(env) ? 'fake' : 'off';
}

/**
 * The marketplace search index (M6.14a, P6-11), or null when search v2 is off (production until
 * the owner's Meilisearch Cloud account exists: owner inbox). `MEILISEARCH_URL` +
 * `MEILISEARCH_ADMIN_KEY` + `MEILISEARCH_SEARCH_KEY` select Meilisearch; dev and CI (and
 * `MEILISEARCH_URL=fake`) get the in-memory fake, never in a production build without dev sign-in.
 */
export function searchIndexFromEnv(env: Env = process.env): SearchIndex | null {
  const kind = configuredSearchIndex(env);
  if (kind === 'off') return null;
  if (kind === 'fake') {
    const fake = devFakeMeilisearch();
    return meilisearchIndex({ ...fake.config, fetch: fake.fetch, inMemory: true, taskTimeoutMs: 1000 });
  }
  const cfg: MeilisearchConfig = {
    url: (env.MEILISEARCH_URL ?? '').trim(),
    adminKey: env.MEILISEARCH_ADMIN_KEY ?? '',
    searchKey: env.MEILISEARCH_SEARCH_KEY ?? '',
    ...(env.MEILISEARCH_INDEX ? { index: env.MEILISEARCH_INDEX } : {}),
  };
  return meilisearchIndex(cfg);
}
