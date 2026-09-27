import 'server-only';
import { sitemapListings } from '@yayatoh/marketplace';
import type { SitemapPage } from '@/lib/seo/sitemap.ts';
import type { HostSite } from './host-site.ts';

/**
 * The public pages a host is the canonical home of (only public pages: listed events, the
 * organizer pages of orgs listed there, the home and event index). Tenant hosts list the events
 * whose canonical host they are; the marketplace lists apex events.
 */
export async function sitemapPages(site: HostSite): Promise<SitemapPage[] | null> {
  if (site.kind === 'app') return null;
  if (site.kind === 'tenant') {
    const events = await sitemapListings(site.host);
    const latest = events.reduce<Date | null>((m, e) => (!m || e.updatedAt > m ? e.updatedAt : m), null);
    return [
      { path: '/', lastmod: latest },
      ...events.map((e) => ({ path: `/events/${e.slug}`, lastmod: e.updatedAt })),
    ];
  }
  const events = await sitemapListings(null);
  const latest = events.reduce<Date | null>((m, e) => (!m || e.updatedAt > m ? e.updatedAt : m), null);
  const orgs = new Map<string, Date>();
  for (const e of events) {
    const prev = orgs.get(e.orgSlug);
    if (!prev || e.updatedAt > prev) orgs.set(e.orgSlug, e.updatedAt);
  }
  return [
    { path: '/', lastmod: latest },
    { path: '/events', lastmod: latest },
    ...[...orgs].map(([slug, lastmod]) => ({ path: `/o/${slug}`, lastmod })),
    ...events.map((e) => ({ path: `/events/${e.slug}`, lastmod: e.updatedAt })),
  ];
}
