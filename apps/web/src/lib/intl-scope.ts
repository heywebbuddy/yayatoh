/**
 * Pages whose client components need only a few message namespaces (M4.7a). The root layout hands
 * every client component the whole catalogue (about 500 KB per locale) unless proxy.ts marks the
 * request with one of these scopes; then only the scope's namespaces travel. The guest hub is a
 * phone page with a Lighthouse budget: the full catalogue alone cost it about 200 ms of blocking
 * time on a throttled phone. proxy.ts strips the header from clients and sets it itself.
 */
export const INTL_SCOPE_HEADER = 'x-yy-intl-scope';

const SCOPES = {
  /** `/hub/{token}`: the install and offline notes. */
  hub: ['hub'],
} as const satisfies Record<string, readonly string[]>;

export type IntlScope = keyof typeof SCOPES;

/** The scope of a page path (locale already stripped), or null for the full catalogue. */
export function intlScopeOf(path: string): IntlScope | null {
  return /^\/hub\/[^/]+\/?$/.test(path) ? 'hub' : null;
}

/** The messages a scoped page's client components get, or undefined (the full catalogue). */
export function scopedMessages<M extends Record<string, unknown>>(
  all: M,
  scope: string | null | undefined,
): Partial<M> | undefined {
  if (!scope || !Object.hasOwn(SCOPES, scope)) return undefined;
  const keep: readonly string[] = SCOPES[scope as IntlScope];
  return Object.fromEntries(Object.entries(all).filter(([k]) => keep.includes(k))) as Partial<M>;
}
