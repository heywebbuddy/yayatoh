import type { HostKind } from '../hosts.ts';

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
