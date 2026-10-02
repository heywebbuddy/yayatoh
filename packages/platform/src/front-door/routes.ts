import { LOCALES } from '@yayatoh/contracts';

/**
 * The front door's route-ownership table (M2.4a, roadmap §7.4, ADR 0020). During coexistence the
 * new app answers every request on a legacy host (yayatoh.com, abc.yayatoh.com) and decides, per
 * request, whether it serves the page itself or forwards it to that instance's legacy origin.
 *
 * - **Platform paths** (the new app's own namespaces: its assets, `/api` with the frozen `/api/v2`
 *   facade, sign-in, the widget…) are always served by the new app, never forwarded.
 * - **Moved routes** (this table) are served by the new app when their per-host flag says so:
 *   `legacy` (the default), `canary` (only for browsers with the `yy_canary=next` cookie) or
 *   `next`. A browser with `yy_legacy=1` always gets legacy for moved routes (the escape hatch).
 * - **Everything else** goes to legacy.
 *
 * The table is code, versioned: flags name a route by its key, and a key that is no longer in the
 * table is ignored (its paths fall back to legacy). Bump `ROUTE_TABLE_VERSION` whenever a route
 * is added, removed or changes what it matches; flag changes record the version they were made on.
 */
export const ROUTE_TABLE_VERSION = 2;

/** The two legacy instances (roadmap §7.4): yayatoh.com and abc.yayatoh.com. */
export const FRONT_DOOR_INSTANCES = ['yay', 'abc'] as const;
export type FrontDoorInstance = (typeof FRONT_DOOR_INSTANCES)[number];

export const ROUTE_STATES = ['legacy', 'canary', 'next'] as const;
export type RouteState = (typeof ROUTE_STATES)[number];

/** Coexistence stages (roadmap §7.4) the table's routes belong to. */
export type FrontDoorStage = 'A1' | 'A2';

export interface FrontDoorRoute {
  /** Stable key: flags, counters and the audit trail name the route by it. */
  readonly key: string;
  readonly stage: FrontDoorStage;
  /** The instances whose hosts may move this route (abc has no marketplace listing or search). */
  readonly instances: readonly FrontDoorInstance[];
  /** Human-readable URL shapes for the staff console. */
  readonly shapes: readonly string[];
  /** Whether a locale-less, normalized path (and its query) is this route. */
  readonly matches: (path: string, query: URLSearchParams) => boolean;
}

const re = (r: RegExp) => (path: string) => r.test(path);
/** Query parameters that turn the listing into a search (new: `q`…; legacy Eventmie: `search`). */
const SEARCH_PARAMS = ['q', 'search', 'city', 'category', 'price', 'from', 'to', 'type'] as const;
const isSearch = (q: URLSearchParams) => SEARCH_PARAMS.some((k) => (q.get(k) ?? '') !== '');

/**
 * Version 1: read surfaces first (A1 content, A2 public reads). Version 2 (batch 3c merge): the
 * new public pages of M3.11a/b (pricing, help center, features, contact, status) on the
 * marketplace instance; like every route they stay on legacy until staff move them. Order
 * matters: first match wins.
 */
export const FRONT_DOOR_ROUTES: readonly FrontDoorRoute[] = [
  { key: 'home', stage: 'A2', instances: ['yay', 'abc'], shapes: ['/'], matches: (p) => p === '/' },
  {
    key: 'events.search',
    stage: 'A2',
    instances: ['yay'],
    shapes: ['/events?q=…', '/events?search=…'],
    matches: (p, q) => p === '/events' && isSearch(q),
  },
  {
    key: 'events.listing',
    stage: 'A2',
    instances: ['yay'],
    shapes: ['/events'],
    matches: (p) => p === '/events',
  },
  {
    // Only the public page: `/events/{slug}/attendee`, checkout and the rest stay on legacy.
    key: 'events.page',
    stage: 'A2',
    instances: ['yay', 'abc'],
    shapes: ['/events/{slug}'],
    matches: re(/^\/events\/[^/]+$/),
  },
  {
    key: 'organizers.page',
    stage: 'A2',
    instances: ['yay'],
    shapes: ['/o/{slug}', '/o/{slug}/blogs', '/o/{slug}/blogs/{post}', '/o/{slug}/pages/{page}'],
    matches: re(/^\/o\/[^/]+(\/blogs|\/blogs\/[^/]+|\/pages\/[^/]+)?$/),
  },
  {
    key: 'venues.page',
    stage: 'A2',
    instances: ['yay'],
    shapes: ['/venues/{slug}'],
    matches: re(/^\/venues\/[^/]+$/),
  },
  {
    key: 'content.blogs',
    stage: 'A1',
    instances: ['yay', 'abc'],
    shapes: ['/blogs', '/blogs/{slug}'],
    matches: re(/^\/blogs(\/[^/]+)?$/),
  },
  {
    key: 'content.pages',
    stage: 'A1',
    instances: ['yay', 'abc'],
    shapes: ['/pages/{slug}'],
    matches: re(/^\/pages\/[^/]+$/),
  },
  {
    key: 'seo.robots',
    stage: 'A1',
    instances: ['yay', 'abc'],
    shapes: ['/robots.txt'],
    matches: (p) => p === '/robots.txt',
  },
  {
    key: 'seo.sitemaps',
    stage: 'A1',
    instances: ['yay', 'abc'],
    shapes: ['/sitemap.xml', '/sitemaps/{file}'],
    matches: re(/^\/(sitemap\.xml|sitemaps\/[^/]+)$/),
  },
  {
    key: 'site.pricing',
    stage: 'A1',
    instances: ['yay'],
    shapes: ['/pricing'],
    matches: (p) => p === '/pricing',
  },
  {
    key: 'site.features',
    stage: 'A1',
    instances: ['yay'],
    shapes: ['/features'],
    matches: (p) => p === '/features',
  },
  {
    key: 'site.contact',
    stage: 'A1',
    instances: ['yay'],
    shapes: ['/contact'],
    matches: (p) => p === '/contact',
  },
  {
    key: 'help.center',
    stage: 'A1',
    instances: ['yay'],
    shapes: ['/help', '/help/search', '/help/{category}', '/help/{category}/{article}'],
    matches: re(/^\/help(\/[^/]+){0,2}$/),
  },
  {
    key: 'site.status',
    stage: 'A1',
    instances: ['yay'],
    shapes: ['/status'],
    matches: (p) => p === '/status',
  },
];

export const FRONT_DOOR_ROUTE_KEYS: ReadonlySet<string> = new Set(FRONT_DOOR_ROUTES.map((r) => r.key));

/** Counter and audit key for the new app's own paths and for everything legacy keeps. */
export const PLATFORM_ROUTE = 'platform';
export const LEGACY_ROUTE = 'legacy';

/**
 * The new app's own namespaces: never forwarded, whatever the flags say. `/api` (and so the frozen
 * `/api/v2` facade), `/_next`, `/_vercel` and `/media` never even reach proxy.ts (its matcher);
 * they are listed so the table is the one place that says so. Only paths the legacy app has no
 * page for belong here (§7.7's unchanged paths never do).
 */
export const PLATFORM_PREFIXES: readonly string[] = [
  '/api',
  '/_next',
  '/_vercel',
  '/media',
  '/embed',
  '/auth',
  '/sign-in',
  '/signup',
  '/my-tickets',
  '/claim',
  '/invite',
  '/survey',
  '/sub-processors',
  // Batch 3e merge: links people get by email lead to pages only the new app has (the legacy app
  // has none): unsubscribe, tracked links (M3.8a, campaign buttons M3.6b), waitlist places
  // (M3.10a) and registration form resume links (M5.1b).
  '/unsubscribe',
  '/r',
  '/waitlist',
  '/registration-form',
];

/**
 * New-app pages under paths legacy owns (`/events/{slug}/…`): never forwarded either. Batch 3e
 * merge: the registration pages of M5.1a and M5.1b, and the M3.10a waitlist join page.
 */
export const PLATFORM_PATTERNS: readonly RegExp[] = [
  /^\/events\/[^/]+\/(register|registration-form|waitlist)$/,
  // M5.1c: group registration, an applicant's or registrant's own page, the payer's group page.
  /^\/events\/[^/]+\/register\/group$/,
  /^\/events\/[^/]+\/(registration|group)\/[^/]+$/,
];
export const PLATFORM_FILES: ReadonlySet<string> = new Set([
  '/widget.js',
  '/push-sw.js',
  '/scan-sw.js',
  '/scan-icon.svg',
  '/scan.webmanifest',
]);

export function isPlatformPath(path: string): boolean {
  if (PLATFORM_FILES.has(path)) return true;
  if (PLATFORM_PATTERNS.some((r) => r.test(path))) return true;
  return PLATFORM_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

const LOCALE_SET = new Set<string>(LOCALES);

/**
 * The path without the new app's locale prefix (`/ar/events/x` → `/events/x`) and without a
 * trailing slash. The legacy app has no locale prefixes, so matching and forwarding use this.
 */
export function stripFrontDoorLocale(path: string): { locale: string | null; rest: string } {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') || '/' : path || '/';
  const [, first = '', ...more] = clean.split('/');
  if (LOCALE_SET.has(first)) return { locale: first, rest: `/${more.join('/')}`.replace(/\/$/, '') || '/' };
  return { locale: null, rest: clean };
}

/** The moved route a path belongs to on an instance, or null (legacy keeps it). */
export function matchFrontDoorRoute(
  instance: FrontDoorInstance,
  path: string,
  query: URLSearchParams,
): FrontDoorRoute | null {
  return FRONT_DOOR_ROUTES.find((r) => r.instances.includes(instance) && r.matches(path, query)) ?? null;
}

/** Flag states keyed `host|route`. A missing entry is `legacy`. */
export type FlagStates = ReadonlyMap<string, RouteState>;
export const flagKey = (host: string, route: string) => `${host}|${route}`;

export const CANARY_COOKIE = 'yy_canary';
export const LEGACY_COOKIE = 'yy_legacy';

export interface FrontDoorOverrides {
  /** `yy_canary=next`: canary routes are served by the new app. */
  readonly canary: boolean;
  /** `yy_legacy=1`: every moved route goes to legacy (platform paths stay on the new app). */
  readonly legacy: boolean;
}

export type FrontDoorDecision =
  | {
      readonly owner: 'next';
      readonly route: string;
      readonly reason: 'platform' | 'flag' | 'canary' | 'cutover';
    }
  | {
      readonly owner: 'legacy';
      readonly route: string;
      readonly reason: 'unowned' | 'flag' | 'override' | 'cutover';
    };

/**
 * The cutover host route (M2.5a, `platform.ops_flags` `host_route:<host>`, set by the cutover
 * tool): `next` moves the whole host to the new app (the flip, no DNS change), `legacy` sends the
 * whole host back (the rollback before the point of no return). Null: the route table decides.
 */
export type HostRouteTarget = 'next' | 'legacy' | null;

/**
 * Who serves a request on a coexistence host. Pure: the caller supplies the flags (cached) and the
 * override cookies. `path` is the request path as received (a locale prefix is ignored).
 */
export function decideFrontDoor(input: {
  readonly instance: FrontDoorInstance;
  readonly host: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly flags: FlagStates;
  readonly overrides: FrontDoorOverrides;
  /** The host's cutover route (M2.5a); it overrides the per-route flags for the whole host. */
  readonly hostRoute?: HostRouteTarget;
}): FrontDoorDecision {
  const { rest } = stripFrontDoorLocale(input.path);
  if (isPlatformPath(input.path) || isPlatformPath(rest))
    return { owner: 'next', route: PLATFORM_ROUTE, reason: 'platform' };
  const route = matchFrontDoorRoute(input.instance, rest, input.query);
  // Batch 3c merge: M2.5a's host-wide cutover switch over M2.4a's per-route table. The cookies
  // keep letting testers see the other side (`yy_canary=next`, `yy_legacy=1`).
  const key = route?.key ?? LEGACY_ROUTE;
  if (input.hostRoute === 'next')
    return input.overrides.legacy
      ? { owner: 'legacy', route: key, reason: 'override' }
      : { owner: 'next', route: key, reason: 'cutover' };
  if (input.hostRoute === 'legacy')
    return input.overrides.canary
      ? { owner: 'next', route: key, reason: 'canary' }
      : { owner: 'legacy', route: key, reason: 'cutover' };
  if (!route) return { owner: 'legacy', route: LEGACY_ROUTE, reason: 'unowned' };
  if (input.overrides.legacy) return { owner: 'legacy', route: route.key, reason: 'override' };
  const state = input.flags.get(flagKey(input.host, route.key)) ?? 'legacy';
  if (state === 'next') return { owner: 'next', route: route.key, reason: 'flag' };
  if (state === 'canary' && input.overrides.canary)
    return { owner: 'next', route: route.key, reason: 'canary' };
  return { owner: 'legacy', route: route.key, reason: 'flag' };
}

/**
 * A host routed back to legacy (M2.5a) that has no legacy origin configured: the front door
 * answers 503 (maintenance) instead of letting the new app pretend to be legacy. The new app's
 * own paths keep working, and `yy_canary=next` still shows testers the new app.
 */
export function cutoverUnavailable(input: {
  readonly hostRoute: HostRouteTarget;
  readonly path: string;
  readonly canary: boolean;
}): boolean {
  if (input.hostRoute !== 'legacy' || input.canary) return false;
  const { rest } = stripFrontDoorLocale(input.path);
  return !isPlatformPath(input.path) && !isPlatformPath(rest);
}
