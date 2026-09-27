import 'server-only';
import { unstable_cache } from 'next/cache';
import { type CacheScope, cacheKey, scopeTag } from '@/lib/cache-keys.ts';

/** Public reads are fresh within this many seconds even without a revalidation call. */
export const PUBLIC_TTL_SECONDS = 30;

/**
 * The only way to cache a public read (check-modules forbids `unstable_cache` / `'use cache'`
 * elsewhere): the key and the tag carry the scope. Values round-trip through JSON, so callers
 * pass `revive` to restore dates.
 */
export function publicCached<T>(
  scope: CacheScope,
  parts: readonly unknown[],
  load: () => Promise<T>,
  revive: (raw: unknown) => T,
): Promise<T> {
  const cached = unstable_cache(load, cacheKey(scope, parts), {
    tags: [scopeTag(scope)],
    revalidate: PUBLIC_TTL_SECONDS,
  });
  return cached().then(revive);
}
