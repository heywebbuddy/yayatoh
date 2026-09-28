import { pageTypeOf } from '@yayatoh/platform/security';
import { type HostKind, indexable } from '../hosts.ts';

/**
 * Private areas never crawled on any public host (buyer, holder and organizer pages; M1.14a):
 * secret-link pages, checkout, the scanner, sign-in and the console below `/o/{slug}` (the org's
 * own public page, `/o/{slug}`, stays crawlable on the marketplace).
 */
export const PRIVATE_PATHS = [
  '/o/*/',
  '/api/',
  '/checkout/',
  '/orders/',
  '/my-tickets/',
  '/claim/',
  '/portal/',
  '/scan',
  '/dev/',
  '/sign-in',
  '/signup',
  '/invite/',
  '/connect/',
  '/embed/',
  // M1.2f: password reset, provider sign-in and a person's own tickets on a tenant site.
  '/forgot-password',
  '/reset-password',
  '/auth/',
  '/tickets',
];

/**
 * robots.txt per host (roadmap §4.2: each host serves its own). Public hosts allow crawling
 * except private areas and point at their sitemap index; the dashboard and dev/preview hosts
 * disallow everything.
 */
export function robotsTxt(kind: HostKind, origin: string): string {
  if (kind === 'app' || kind === 'dev') return 'User-agent: *\nDisallow: /\n';
  const lines = ['User-agent: *', 'Allow: /', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`)];
  if (kind === 'marketplace') lines.push('Disallow: /organizers/');
  return `${lines.join('\n')}\n\nSitemap: ${origin}/sitemap.xml\n`;
}

/** The `X-Robots-Tag` of every never-indexed response. */
export const NOINDEX = 'noindex, nofollow';

/**
 * Private pages (path without the locale): the console, checkout, secret-link pages, the scanner,
 * sign-in, the widget frame, unlock, message and unsubscribe links, the account, internal
 * segments. On the marketplace `/o/{slug}` itself is the public organizer page; anywhere else
 * `/o/…` is the console.
 */
export function isPrivatePage(kind: HostKind, path: string): boolean {
  if (kind === 'marketplace' && /^\/o\/[^/]+\/?$/.test(path)) return false;
  if (pageTypeOf(path) !== 'public') return true;
  return /^\/(?:embed|messages|unsubscribe|account|dev|t|organizers|api|forgot-password|reset-password|auth|tickets)(?:\/|$)|^\/events\/[^/]+\/unlock\/?$/.test(
    path,
  );
}

/**
 * The noindex guard (M1.11d). Hosts that are never indexed (dashboard, localhost, previews) and
 * private pages send `X-Robots-Tag: noindex, nofollow` on every response; public pages on public
 * hosts send none (their metadata alone decides: unlisted and finished events say noindex).
 */
export function robotsHeader(kind: HostKind, path: string): string | null {
  return !indexable(kind) || isPrivatePage(kind, path) ? NOINDEX : null;
}

/** The robots meta of a public page: indexed on public hosts unless the page opts out. */
export function robotsMeta(kind: HostKind, index = true): { index: boolean; follow: boolean } {
  return { index: index && indexable(kind), follow: true };
}
