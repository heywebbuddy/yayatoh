import type { OpenAPIHono, RouteConfig } from '@hono/zod-openapi';
import { createMiddleware } from 'hono/factory';

/**
 * A route's deprecation (the declarative marker). `since` becomes the RFC 9745 `Deprecation`
 * header, `sunset` the RFC 8594 `Sunset` header (after it the route may answer 410), `link` a
 * `Link: <…>; rel="deprecation"` to the migration notes. /v1 is additive only: a route is
 * deprecated with a replacement, and removed only after its sunset with owner approval.
 */
export interface Deprecation {
  readonly since: Date;
  readonly sunset?: Date;
  readonly link?: string;
}

const MARK = 'x-yayatoh-deprecation';

/** Mark a route deprecated: the docs show it (`deprecated: true`) and every response carries the headers. */
export function deprecated<R extends RouteConfig>(route: R, d: Deprecation): R {
  if (d.sunset && d.sunset <= d.since) throw new Error(`${route.path}: sunset must come after deprecation`);
  return {
    ...route,
    deprecated: true,
    [MARK]: {
      since: d.since.toISOString(),
      ...(d.sunset ? { sunset: d.sunset.toISOString() } : {}),
      ...(d.link ? { link: d.link } : {}),
    },
  };
}

type Marked = { readonly method: string; readonly path: string; readonly [MARK]?: Record<string, string> };

/** `/orgs/{org}/x` (OpenAPI) → `/orgs/:org/x` (Hono). */
const honoPath = (p: string) => p.replace(/\{([^}]+)\}/g, ':$1');

/** The marked routes of an app, keyed `METHOD /path` in Hono's syntax (relative to the app). */
export function deprecations(app: OpenAPIHono<never> | OpenAPIHono): Map<string, Deprecation> {
  const out = new Map<string, Deprecation>();
  for (const def of app.openAPIRegistry.definitions) {
    if (def.type !== 'route') continue;
    const r = def.route as unknown as Marked;
    const m = r[MARK];
    if (!m?.since) continue;
    out.set(`${r.method.toUpperCase()} ${honoPath(r.path)}`, {
      since: new Date(m.since),
      ...(m.sunset ? { sunset: new Date(m.sunset) } : {}),
      ...(m.link ? { link: m.link } : {}),
    });
  }
  return out;
}

/** The response headers for one deprecation. */
export function deprecationHeaders(d: Deprecation): Record<string, string> {
  const h: Record<string, string> = { deprecation: `@${Math.floor(d.since.getTime() / 1000)}` };
  const links: string[] = [];
  if (d.sunset) h.sunset = d.sunset.toUTCString();
  if (d.link) links.push(`<${d.link}>; rel="deprecation"; type="text/html"`);
  if (d.sunset && d.link) links.push(`<${d.link}>; rel="sunset"; type="text/html"`);
  if (links.length > 0) h.link = links.join(', ');
  return h;
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `GET /orgs/:org/x` → a matcher for `GET {basePath}/orgs/{anything}/x`. */
function matcher(key: string, basePath: string) {
  const [method, path = ''] = key.split(' ');
  const re = new RegExp(
    `^${reEscape(basePath)}${path
      .split(/:[^/]+/)
      .map(reEscape)
      .join('[^/]+')}/?$`,
  );
  return (m: string, p: string) => m === method && re.test(p);
}

/**
 * Adds `Deprecation` / `Sunset` / `Link` to every response of a marked route, errors included
 * (it matches the request path, so a 401 or 429 from earlier middleware carries them too). The
 * table is read from the app's OpenAPI registry on first use, after every route is mounted.
 */
export function deprecationMiddleware(app: OpenAPIHono<never> | OpenAPIHono, basePath: string) {
  let table: { match: (m: string, p: string) => boolean; d: Deprecation }[] | undefined;
  return createMiddleware(async (c, next) => {
    await next();
    table ??= [...deprecations(app)].map(([key, d]) => ({ match: matcher(key, basePath), d }));
    const hit = table.find((t) => t.match(c.req.method, c.req.path));
    if (!hit) return;
    for (const [k, v] of Object.entries(deprecationHeaders(hit.d))) c.res.headers.set(k, v);
  });
}
