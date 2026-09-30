/** A stored legacy redirect (roadmap §7.7). */
export interface RedirectRule {
  readonly source: string;
  readonly match: 'exact' | 'prefix';
  readonly target: string;
  readonly status: number;
}

/**
 * Normalize a request path for lookup: no trailing slash (except `/`), percent-decoding left to
 * the router, lowercase kept (legacy slugs are lowercase already; paths are case-sensitive).
 */
export function normalizePath(path: string): string {
  const p = path.split('?')[0]?.split('#')[0] ?? '/';
  if (p.length > 1 && p.endsWith('/')) return p.replace(/\/+$/, '') || '/';
  return p || '/';
}

/**
 * Where a matched rule sends a path. A prefix rule carries the rest of the path over
 * (`/organiser/*` → `/o/*`); the query string is kept either way.
 */
export function redirectLocation(rule: RedirectRule, pathWithQuery: string): string {
  const [path = '/', query] = pathWithQuery.split('?', 2);
  const clean = normalizePath(path);
  let target = rule.target;
  if (rule.match === 'prefix' && clean.startsWith(rule.source)) {
    const rest = clean.slice(rule.source.length);
    target = `${rule.target.replace(/\/$/, '')}${rest.startsWith('/') || rest === '' ? rest : `/${rest}`}`;
  }
  return query ? `${target}${target.includes('?') ? '&' : '?'}${query}` : target;
}

/** Choose the rule for a path: an exact match wins, else the longest prefix on a segment boundary. */
export function pickRedirect(rules: readonly RedirectRule[], path: string): RedirectRule | null {
  const clean = normalizePath(path);
  const exact = rules.find((r) => r.match === 'exact' && r.source === clean);
  if (exact) return exact;
  const prefixes = rules
    .filter(
      (r) =>
        r.match === 'prefix' &&
        (clean === r.source || clean.startsWith(r.source.endsWith('/') ? r.source : `${r.source}/`)),
    )
    .sort((a, b) => b.source.length - a.source.length);
  return prefixes[0] ?? null;
}

/** The most rules a chain is followed through before the final URL is sent. */
export const MAX_REDIRECT_HOPS = 5;

/**
 * One redirect for a request, never a chain (M2.4a): when a rule's target is itself a legacy URL on
 * the same host (rules written at different times: `/organiser/x` → `/x` → `/o/x`), the chain is
 * followed and the client is sent straight to the final URL with the first rule's status. A loop
 * answers null (better a legacy page than a redirect loop).
 */
export async function followRedirectChain(
  match: (path: string) => RedirectRule | null | Promise<RedirectRule | null>,
  pathWithQuery: string,
  maxHops = MAX_REDIRECT_HOPS,
): Promise<{ location: string; status: number } | null> {
  const first = await match(normalizePath(pathWithQuery));
  if (!first) return null;
  const seen = new Set([normalizePath(pathWithQuery)]);
  let location = redirectLocation(first, pathWithQuery);
  for (let hop = 1; hop < maxHops && location.startsWith('/'); hop++) {
    const path = normalizePath(location);
    if (seen.has(path)) return null;
    seen.add(path);
    const next = await match(path);
    if (!next) break;
    location = redirectLocation(next, location);
  }
  return { location, status: first.status };
}
