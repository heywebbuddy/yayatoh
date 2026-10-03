import 'server-only';
import {
  configuredSearchIndex,
  devFakeMeilisearch,
  reindexAll,
  type SearchIndex,
  searchIndexFromEnv,
} from '@yayatoh/marketplace';

let index: SearchIndex | null | undefined;
let loading: Promise<void> | null = null;

/**
 * The marketplace search index for this deployment (M6.14a): Meilisearch once the owner's account
 * is configured, the in-memory Meilisearch fake in dev, CI and previews, null (search v2 off)
 * otherwise. The fake lives in this process, so the first use loads it from the public read model;
 * after that only the outbox feeds it (the dev drain `/api/dev/search/run`).
 */
export async function searchIndex(): Promise<SearchIndex | null> {
  if (index === undefined) index = searchIndexFromEnv(process.env);
  if (!index?.inMemory) return index;
  const fake = devFakeMeilisearch();
  if (!fake.loaded) {
    const ix = index;
    loading ??= reindexAll(ix)
      .then(() => {
        fake.loaded = true;
      })
      .finally(() => {
        loading = null;
      });
    await loading;
  }
  return index;
}

/** Search v2 is on (a configured index). */
export const searchEnabled = async () => (await searchIndex()) !== null;

/** Search v2 is configured (no connection, no load: for links to it). */
export const searchConfigured = () => configuredSearchIndex(process.env) !== 'off';
