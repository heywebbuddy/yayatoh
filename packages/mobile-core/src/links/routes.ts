/**
 * Deep links (M7.1c): maps a universal link, an app-scheme link or a push payload to a route the
 * app can open, and refuses everything else.
 *
 * The path allowlist is the one the server publishes in `apple-app-site-association` (M7.2d,
 * `apps/web/src/lib/app-links.ts`): event pages, short links, a ticket, an order and a transfer
 * claim for the attendee app; `/scan#e=…&k=…` for Staff enrolment. A native push carries the same
 * kind of path as `data.path` (`/tickets/{id}`, `/orders/{id}`, `/events/{slug}`; M7.2c).
 *
 * The result is an Expo Router `pathname` with `params`, never a string with values spliced in, so
 * a link can only fill the dynamic segments the screen declares. Secrets stay in `params`: the
 * Staff enrolment key arrives in the URL fragment and must never be logged or sent anywhere.
 */
import { LOCALES } from '../i18n/locales';

export interface AppRoute {
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
}

export type LinkApp = 'mobile' | 'staff';

export interface LinkOptions {
  readonly app: LinkApp;
  /** The apex tenant subdomains live under (`yayatoh.events`). */
  readonly tenantDomain?: string;
  /** The app's URL scheme (`yayatoh`, `yayatoh-staff`, with `-dev` or `-preview`). */
  readonly schemes?: readonly string[];
}

/** The routes the apps implement (M7.3 and M7.4 build the screens). */
export const ROUTES = {
  event: '/events/[slug]',
  eventShort: '/e/[code]',
  ticket: '/tickets/[id]',
  ticketLink: '/tickets/link/[token]',
  order: '/orders/[id]',
  orderLink: '/orders/link/[token]',
  claim: '/claim/[token]',
  enrol: '/enrol',
} as const;

export const PLATFORM_HOSTS = ['yayatoh.com', 'www.yayatoh.com', 'app.yayatoh.com'] as const;
const DEFAULT_TENANT_DOMAIN = 'yayatoh.events';
const DEFAULT_SCHEMES = [
  'yayatoh',
  'yayatoh-dev',
  'yayatoh-preview',
  'yayatoh-staff',
  'yayatoh-staff-dev',
  'yayatoh-staff-preview',
];

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_.~-]{8,512}$/;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i;

interface Parts {
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
  readonly fragment: string;
}

function split(url: string): Parts | null {
  const m = URL_PARTS.exec(url.trim());
  if (!m) return null;
  return {
    scheme: (m[1] ?? '').toLowerCase(),
    host: (m[2] ?? '').toLowerCase(),
    path: m[3] ?? '',
    fragment: m[5] ?? '',
  };
}

/** `a=1&b=2` as a record. Values are used as given: callers validate each one they read. */
function fields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of text.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    } catch {
      // A malformed escape drops that field.
    }
  }
  return out;
}

/** The path split into segments with an optional locale prefix removed; null if it has anything odd. */
function segmentsOf(path: string): string[] | null {
  const raw = path.split('/').filter((s) => s !== '');
  if (raw.some((s) => !SEGMENT.test(s))) return null;
  const first = raw[0];
  if (first && first !== 'en' && (LOCALES as readonly string[]).includes(first)) raw.shift();
  return raw;
}

function tenantOf(host: string, tenantDomain: string): string | null | undefined {
  if ((PLATFORM_HOSTS as readonly string[]).includes(host)) return null;
  const suffix = `.${tenantDomain}`;
  if (host.endsWith(suffix)) {
    const sub = host.slice(0, -suffix.length);
    return SUBDOMAIN.test(sub) ? sub : undefined;
  }
  return undefined;
}

function attendeeRoute(segments: readonly string[], org: string | null): AppRoute | null {
  const [a, b, ...rest] = segments;
  if (!a || !b || rest.length > 0) return null;
  const withOrg = (params: Record<string, string>) => (org ? { ...params, org } : params);
  switch (a) {
    case 'events':
      return { pathname: ROUTES.event, params: withOrg({ slug: b }) };
    case 'e':
      return { pathname: ROUTES.eventShort, params: withOrg({ code: b }) };
    case 'my-tickets':
      return { pathname: ROUTES.ticketLink, params: { token: b } };
    case 'orders':
      return { pathname: ROUTES.orderLink, params: { token: b } };
    case 'claim':
      return { pathname: ROUTES.claim, params: { token: b } };
    default:
      return null;
  }
}

function staffRoute(segments: readonly string[], fragment: string): AppRoute | null {
  if (segments.length !== 1 || segments[0] !== 'scan') return null;
  // The enrolment key lives in the fragment so it never reaches a server log; a link that put it in
  // the query is not one of ours.
  const { e, k } = fields(fragment);
  if (!e || !k || !UUID.test(e) || !SECRET.test(k)) return null;
  return { pathname: ROUTES.enrol, params: { event: e, key: k } };
}

/**
 * The route for a universal link (`https://abc.yayatoh.events/events/summit`) or an app-scheme link
 * (`yayatoh://claim/abc123`). Null for a host we do not serve, a path we do not allow, a segment
 * with anything but letters, digits, `-` and `_`, or a link meant for the other app.
 */
export function routeForLink(url: string, options: LinkOptions): AppRoute | null {
  const parts = split(url);
  if (!parts) return null;
  const tenantDomain = (options.tenantDomain ?? DEFAULT_TENANT_DOMAIN).toLowerCase();
  const schemes = options.schemes ?? DEFAULT_SCHEMES;

  let org: string | null = null;
  let path = parts.path;
  if (parts.scheme === 'https') {
    const tenant = tenantOf(parts.host, tenantDomain);
    if (tenant === undefined) return null;
    org = tenant;
  } else if (schemes.includes(parts.scheme)) {
    // `yayatoh://claim/abc`: the first path segment is parsed as a host.
    path = `/${parts.host}${parts.path}`;
  } else {
    return null;
  }
  const segments = segmentsOf(path);
  if (!segments) return null;
  return options.app === 'staff' ? staffRoute(segments, parts.fragment) : attendeeRoute(segments, org);
}

/**
 * The route for a tapped notification. `data` is the notification's data object (or its `path`
 * string). Only the three paths the server sends are accepted.
 */
export function routeForPush(data: unknown): AppRoute | null {
  const path =
    typeof data === 'string'
      ? data
      : data && typeof data === 'object' && typeof (data as { path?: unknown }).path === 'string'
        ? (data as { path: string }).path
        : null;
  if (!path || path.length > 300 || !path.startsWith('/') || path.includes('?') || path.includes('#'))
    return null;
  const segments = path.split('/').filter((s) => s !== '');
  if (segments.length !== 2 || segments.some((s) => !SEGMENT.test(s))) return null;
  const [kind, id] = segments as [string, string];
  switch (kind) {
    case 'tickets':
      return UUID.test(id) ? { pathname: ROUTES.ticket, params: { id } } : null;
    case 'orders':
      return UUID.test(id) ? { pathname: ROUTES.order, params: { id } } : null;
    case 'events':
      return { pathname: ROUTES.event, params: { slug: id } };
    default:
      return null;
  }
}
