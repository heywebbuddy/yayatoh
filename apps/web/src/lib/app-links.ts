import { LOCALES } from '@yayatoh/contracts';
import { appHosts, marketplaceHosts } from './hosts.ts';

/**
 * Universal links / app links for the two mobile apps (M7.2d, decision P7-9's companion in
 * docs/plans/mobile.md). Pure: proxy.ts answers the two well-known files with these.
 *
 * - iOS reads `/.well-known/apple-app-site-association` (no extension) from every host in the
 *   build's Associated Domains; Android reads `/.well-known/assetlinks.json`. Both are JSON, fetched
 *   by the OS (Apple through its CDN) and must never redirect.
 * - Only hosts the apps' entitlements can list serve them: the platform hosts (yayatoh.com,
 *   app.yayatoh.com) and the tenant subdomains of `TENANT_APEX`. A tenant's own custom domain is
 *   not in the build, so it answers 404 (its web page offers "Open in the app" through app.yayatoh.com).
 * - Everything comes from env (names in `.env.example`); an app with no configured identifier is
 *   left out, so an unconfigured environment serves valid, empty files rather than a broken one.
 */

export const AASA_PATH = '/.well-known/apple-app-site-association';
export const ASSETLINKS_PATH = '/.well-known/assetlinks.json';

type Env = Record<string, string | undefined>;

/** Whether `path` is one of the two well-known files (an exact match: no trailing slash, no locale). */
export const isAppLinksPath = (path: string) => path === AASA_PATH || path === ASSETLINKS_PATH;

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** The apex that tenant subdomains live under (`TENANT_APEX`, default yayatoh.events). */
const tenantApexOf = (env: Env) => (env.TENANT_APEX ?? 'yayatoh.events').trim().toLowerCase();

/**
 * Whether a (bare, lowercased) host serves the link files: a marketplace host, the dashboard host,
 * a subdomain of the tenant apex, or a host listed in `APP_LINK_EXTRA_HOSTS`. Never a custom tenant domain, a preview or localhost.
 */
export function appLinksHost(host: string, env: Env = process.env): boolean {
  if (marketplaceHosts(env).includes(host) || appHosts(env).includes(host)) return true;
  // Platform-owned hosts that are tenants in the database but can sit in the builds' entitlements
  // (`abc.yayatoh.com`, which opens the Yayatoh app: decision P7-4). Never an organizer's own domain.
  if (list(env.APP_LINK_EXTRA_HOSTS).includes(host)) return true;
  const apex = tenantApexOf(env);
  return host.length > apex.length + 1 && host.endsWith(`.${apex}`);
}

const BUNDLE_ID = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const TEAM_ID = /^[A-Z0-9]{10}$/;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** The attendee app (tickets, orders, claims, events) and the Staff app (door enrolment). */
export interface AppLinkConfig {
  readonly teamId: string | null;
  readonly attendee: { readonly bundleIds: string[]; readonly packages: AndroidTarget[] };
  readonly staff: { readonly bundleIds: string[]; readonly packages: AndroidTarget[] };
}
export interface AndroidTarget {
  readonly packageName: string;
  readonly fingerprints: string[];
}

function androidTargets(packages: string | undefined, fingerprints: string | undefined): AndroidTarget[] {
  const names = list(packages).filter((p) => PACKAGE.test(p));
  // The fingerprints are the app's signing certificates (Play App Signing's and the upload key),
  // shared by that app's packages (one per environment).
  const prints = list(fingerprints)
    .map((f) => f.toUpperCase())
    .filter((f) => SHA256.test(f));
  return prints.length ? names.map((packageName) => ({ packageName, fingerprints: prints })) : [];
}

/** Read the link identifiers from env; anything malformed is dropped (never served). */
export function appLinkConfig(env: Env = process.env): AppLinkConfig {
  const team = env.APPLE_TEAM_ID?.trim().toUpperCase() ?? '';
  return {
    teamId: TEAM_ID.test(team) ? team : null,
    attendee: {
      bundleIds: list(env.IOS_ATTENDEE_BUNDLE_IDS).filter((b) => BUNDLE_ID.test(b)),
      packages: androidTargets(env.ANDROID_ATTENDEE_PACKAGES, env.ANDROID_ATTENDEE_SHA256_FINGERPRINTS),
    },
    staff: {
      bundleIds: list(env.IOS_STAFF_BUNDLE_IDS).filter((b) => BUNDLE_ID.test(b)),
      packages: androidTargets(env.ANDROID_STAFF_PACKAGES, env.ANDROID_STAFF_SHA256_FINGERPRINTS),
    },
  };
}

/**
 * The path allowlist (relative to a locale prefix): event pages (`/events/{slug}`, the `/e/{short}`
 * links), a ticket (`/my-tickets/{token}`), an order (`/orders/{token}`) and a transfer claim
 * (`/claim/{token}`). Nothing else on the site opens the app: sign-in, checkout, the console and
 * every other page stay in the browser.
 */
export const ATTENDEE_PATHS = ['/events/*', '/e/*', '/my-tickets/*', '/orders/*', '/claim/*'] as const;
/** Staff enrolment: `/scan#e={event}&k={key}`. The Staff app claims it; the Scan PWA still opens it in a browser. */
export const STAFF_PATHS = ['/scan'] as const;

/** `/events/*` plus `/{locale}/events/*` for every non-default locale (the default has no prefix). */
const withLocales = (paths: readonly string[]) => [
  ...paths,
  ...LOCALES.filter((l) => l !== 'en').flatMap((l) => paths.map((p) => `/${l}${p}`)),
];

interface AasaComponent {
  '/': string;
  '#'?: string;
}

/** The Apple App Site Association document. */
export function appleAppSiteAssociation(cfg: AppLinkConfig) {
  const id = (b: string) => `${cfg.teamId}.${b}`;
  const attendeeIds = cfg.teamId ? cfg.attendee.bundleIds.map(id) : [];
  const staffIds = cfg.teamId ? cfg.staff.bundleIds.map(id) : [];
  const details: { appIDs: string[]; components: AasaComponent[] }[] = [];
  if (attendeeIds.length)
    details.push({
      appIDs: attendeeIds,
      components: withLocales(ATTENDEE_PATHS).map((p) => ({ '/': p })),
    });
  if (staffIds.length)
    details.push({
      appIDs: staffIds,
      // Only an enrolment link (it carries the `e=` fragment), not the bare scanner page.
      components: withLocales(STAFF_PATHS).map((p) => ({ '/': p, '#': 'e=*' })),
    });
  return {
    applinks: { details },
    // Password autofill: both apps sign in with a password the system can fill from the web's.
    webcredentials: { apps: [...attendeeIds, ...staffIds] },
  };
}

/** The Digital Asset Links statements (assetlinks.json). Path scoping lives in each app's manifest. */
export function assetLinks(cfg: AppLinkConfig) {
  return [...cfg.attendee.packages, ...cfg.staff.packages].map((t) => ({
    relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
    target: {
      namespace: 'android_app',
      package_name: t.packageName,
      sha256_cert_fingerprints: t.fingerprints,
    },
  }));
}

/**
 * The response for a well-known path, or null when this host is not one of the app's link domains
 * (the caller answers 404). Cacheable for an hour; never sets a cookie and never redirects.
 */
export function appLinksResponse(path: string, host: string, env: Env = process.env): Response | null {
  if (!isAppLinksPath(path) || !appLinksHost(host, env)) return null;
  const cfg = appLinkConfig(env);
  const body = path === AASA_PATH ? appleAppSiteAssociation(cfg) : assetLinks(cfg);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Where the fake payment page (dev, preview and CI only) sends the buyer after "paying": a path on
 * this origin, or (M7.2f) a universal link of the mobile apps, which the app opens. Anything else
 * goes to the home page.
 */
export function fakeReturnTarget(returnUrl: string, origin: string, env: Env = process.env): string {
  const back = new URL(returnUrl, origin);
  if (back.origin === new URL(origin).origin) return `${back.pathname}${back.search}`;
  return back.protocol === 'https:' && appLinksHost(back.hostname, env) ? back.toString() : '/';
}
