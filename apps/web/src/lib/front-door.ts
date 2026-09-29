/**
 * The cutover front door (M2.5a, roadmap §7.4 and §7.8, ADR 0006): the cutover tool (or staff)
 * sets `host_route:<host>` to `next` or `legacy` in `platform.ops_flags`; the proxy reads it and
 * either serves the request here or rewrites it to that host's legacy origin (`origin-yay.…`,
 * which accepts only requests carrying the front-door secret). No DNS change: flipping the route
 * is the switch, and flipping it back is the rollback before the point of no return.
 * Cookie overrides for testing either side: `yy_canary=next` and `yy_legacy=1`.
 */
export type FrontDoor =
  | { readonly kind: 'next' }
  | { readonly kind: 'legacy'; readonly origin: string }
  /** Routed to legacy but no origin is configured for the host: a maintenance response. */
  | { readonly kind: 'unavailable' };

export const CANARY_COOKIE = 'yy_canary';
export const LEGACY_COOKIE = 'yy_legacy';

/**
 * `LEGACY_ORIGINS`: comma-separated `host=https://origin` pairs (names only in .env.example).
 * Only https origins (or http on localhost, for tests) are accepted; anything else is ignored.
 */
export function parseLegacyOrigins(raw: string | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const pair of (raw ?? '').split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const host = pair.slice(0, eq).trim().toLowerCase();
    const origin = pair.slice(eq + 1).trim();
    try {
      const u = new URL(origin);
      const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost');
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) continue;
      if (u.pathname !== '/' || u.search || u.hash) continue;
      out.set(host, u.origin);
    } catch {
      // Not a URL: ignored.
    }
  }
  return out;
}

export function frontDoor(input: {
  readonly route: 'next' | 'legacy' | null;
  readonly host: string;
  readonly cookies: { readonly canary?: string | undefined; readonly legacy?: string | undefined };
  readonly origins: ReadonlyMap<string, string>;
}): FrontDoor {
  const origin = input.origins.get(input.host);
  // No routing entry: the host is served here (every host the new platform owns by default).
  if (input.route === null) return { kind: 'next' };
  if (input.route === 'next') {
    if (input.cookies.legacy === '1' && origin) return { kind: 'legacy', origin };
    return { kind: 'next' };
  }
  if (input.cookies.canary === 'next') return { kind: 'next' };
  return origin ? { kind: 'legacy', origin } : { kind: 'unavailable' };
}
