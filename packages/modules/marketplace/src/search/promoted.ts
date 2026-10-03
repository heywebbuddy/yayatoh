import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import type { SearchV2Params } from './params.ts';
import type { SearchIndex, SearchQuery } from './port.ts';
import { all, cityCenters, filtersOf, hydrate, resolveCenter, type SearchListingDto } from './query.ts';

/** Promoted placements shown above the results (M6.14b), at most. */
export const PROMOTED_SLOTS = 2;

/** Slugs of listings with a promotion running now (`marketplace.promoted_slugs`, at most 20). */
export async function promotedSlugs(now: Date = new Date()): Promise<string[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ slug: string }>(
      sql`select slug from marketplace.promoted_slugs(${now.toISOString()}::timestamptz)`,
    ),
  );
  return rows.map((r) => r.slug);
}

/**
 * Promoted placements for a search (M6.14b): running promotions that also match the visitor's
 * query and filters (one round trip: one query per candidate), first page only, at most
 * `PROMOTED_SLOTS`. Hydrated from the public read model like every result; callers label them as
 * promoted. Empty when the flag is off (the caller passes it).
 */
export async function promotedPlacements(
  index: SearchIndex,
  p: SearchV2Params,
  now: Date = new Date(),
  opts: { enabled: boolean; slugs?: readonly string[] },
): Promise<SearchListingDto[]> {
  if (!opts.enabled || p.page > 1) return [];
  const candidates = opts.slugs ?? (await promotedSlugs(now));
  if (candidates.length === 0) return [];
  const center = resolveCenter(p, p.near && p.near !== 'me' ? await cityCenters(now) : []);
  const filters = all(filtersOf(p, now, center));
  const queries: SearchQuery[] = candidates.map((slug) => ({
    ...(p.q ? { text: p.q } : {}),
    filters: [...filters, { field: 'slug', eq: slug }],
    page: 1,
    hitsPerPage: 1,
  }));
  const res = await index.search(queries);
  const hits = res.flatMap((r) => r?.hits.slice(0, 1) ?? []).slice(0, PROMOTED_SLOTS);
  return hydrate(hits, now);
}
