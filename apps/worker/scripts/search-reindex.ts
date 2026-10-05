import { closePools } from '@yayatoh/db';
import { reindexAll, searchIndexFromEnv } from '@yayatoh/marketplace';

// Rebuild the marketplace search index (M6.14a) from the public read model:
// `pnpm --filter @yayatoh/worker search:reindex`. Run once after Meilisearch is configured and
// after its settings change; the worker's indexer keeps it current from then on.
const index = searchIndexFromEnv();
if (!index || index.inMemory) {
  console.info(JSON.stringify({ job: 'search-reindex', skipped: 'no Meilisearch configured' }));
} else {
  console.info(JSON.stringify({ job: 'search-reindex', documents: await reindexAll(index) }));
}
await closePools();
