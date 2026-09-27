/**
 * Org-tagged caching (roadmap §3.3, isolation suite step 6 "cache guard"). Every cached public
 * read names its scope: one org (`org:{id}`) or the cross-tenant marketplace projection. The
 * scope leads the key and is the tag, so two orgs can never share an entry and an org's change
 * revalidates exactly its own entries (plus the marketplace, which shows them).
 */
export type CacheScope = { readonly org: string } | 'marketplace';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function scopeTag(scope: CacheScope): string {
  if (scope === 'marketplace') return 'marketplace';
  if (!UUID.test(scope.org)) throw new Error('cache scope needs an org id');
  return `org:${scope.org}`;
}

/** The full cache key: scope first, then the query's own parts (JSON, so types stay distinct). */
export function cacheKey(scope: CacheScope, parts: readonly unknown[]): string[] {
  return [scopeTag(scope), ...parts.map((p) => JSON.stringify(p) ?? 'undefined')];
}

/** Tags to revalidate when an org's public data changes. */
export const orgChangeTags = (orgId: string) => [scopeTag({ org: orgId }), 'marketplace'];
