import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { catchUpSubscriber, defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { LISTING_CHANGED_EVENTS } from '../projector.ts';
import { publicListings } from '../schema.ts';
import { docIdFor, type IndexableListing, type SearchDocument, toSearchDocument } from './document.ts';
import type { SearchIndex } from './port.ts';

export const SEARCH_INDEXER = 'marketplace.search-index';

const Payload = z.object({ eventId: z.uuid() });

/**
 * Bring one listing's search document in line with the projection (M6.14a): read the row under
 * the org's RLS; index it when it is on the marketplace (never a wedding), remove it otherwise.
 * Idempotent: replays converge on the current row, whatever order events arrive in.
 */
export async function syncListingTx(
  tx: TenantTx,
  index: SearchIndex,
  orgId: string,
  eventId: string,
): Promise<'indexed' | 'removed'> {
  const [row] = await tx.select().from(publicListings).where(eq(publicListings.eventId, eventId));
  const doc = row ? toSearchDocument(row as IndexableListing) : null;
  if (doc) {
    await index.upsert([doc]);
    return 'indexed';
  }
  await index.remove([docIdFor(orgId, eventId)]);
  return 'removed';
}

/**
 * The `marketplace.search-index` subscriber (M6.14a): fed only by `marketplace.listing_changed@1`,
 * which the listings projector emits after it rewrote (or dropped) a row, so the index only ever
 * sees the public read model. `onChange` runs after each live event (the worker revalidates the
 * public cache).
 */
export function searchIndexer(deps: {
  readonly index: () => SearchIndex | null;
  readonly onChange?: (orgId: string) => Promise<void>;
}): Subscriber {
  return defineSubscriber({
    name: SEARCH_INDEXER,
    events: [...LISTING_CHANGED_EVENTS],
    // The index is a projection of a projection: history converges it too.
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const index = deps.index();
      if (!index) return;
      const { eventId } = Payload.parse(event.payload);
      await syncListingTx(tx, index, event.orgId, eventId);
      if (!event.replayed) await deps.onChange?.(event.orgId);
    },
  });
}

/** Apply one org's listing changes the indexer has not handled yet (dev drain, e2e, deploy catch-up). */
export function catchUpSearchIndex(orgId: string, deps: Parameters<typeof searchIndexer>[0]) {
  return catchUpSubscriber(searchIndexer(deps), orgId);
}

type Row = Record<string, unknown>;
const REINDEX_PAGE = 500;

/**
 * Rebuild the whole index from the public read model (first load, the fake's per-process load,
 * after settings change): the rows come from the SECURITY DEFINER `marketplace.index_listings`,
 * which returns marketplace rows only, never weddings. Returns how many documents were written.
 */
export async function reindexAll(index: SearchIndex, now: Date = new Date()): Promise<number> {
  await index.setup();
  await index.clear();
  let after = '';
  let n = 0;
  for (;;) {
    const rows = await withoutTenant((tx) =>
      tx.execute<Row>(
        sql`select * from marketplace.index_listings(${after}, ${REINDEX_PAGE}, ${now.toISOString()}::timestamptz)`,
      ),
    );
    if (rows.length === 0) break;
    const docs: SearchDocument[] = [];
    for (const r of rows) {
      const doc = toSearchDocument({
        orgId: String(r.org_id),
        eventId: String(r.event_id),
        slug: String(r.slug),
        name: String(r.name),
        tagline: (r.tagline as string | null) ?? null,
        category: (r.category as string | null) ?? null,
        profile: String(r.profile),
        venueName: (r.venue_name as string | null) ?? null,
        city: (r.city as string | null) ?? null,
        country: (r.country as string | null) ?? null,
        orgSlug: String(r.org_slug),
        orgName: String(r.org_name),
        currency: String(r.currency),
        minPriceMinor: r.min_price_minor === null ? null : Number(r.min_price_minor),
        maxPriceMinor: r.max_price_minor === null ? null : Number(r.max_price_minor),
        startsAt: new Date(String(r.starts_at)),
        endsAt: new Date(String(r.ends_at)),
        popularity: Number(r.popularity ?? 0),
        latitude: r.latitude === null ? null : Number(r.latitude),
        longitude: r.longitude === null ? null : Number(r.longitude),
        onMarketplace: true,
      });
      if (doc) docs.push(doc);
    }
    await index.upsert(docs);
    n += docs.length;
    after = String(rows[rows.length - 1]?.slug ?? '');
    if (rows.length < REINDEX_PAGE) break;
  }
  return n;
}
