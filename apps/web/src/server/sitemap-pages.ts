import 'server-only';
import { sitemapEntries } from '@yayatoh/cms';
import { publicOrganizerById, sitemapListings } from '@yayatoh/marketplace';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import type { SitemapPage } from '@/lib/seo/sitemap.ts';
import { entryPath, marketplaceContentOrg } from './cms.ts';
import type { HostSite } from './host-site.ts';

/** An org's published CMS entries as sitemap pages under `base` (M1.4g), plus its blog index. */
async function contentPages(orgId: string, base: string): Promise<SitemapPage[]> {
  const entries = await sitemapEntries(orgId);
  const posts = entries.filter((e) => e.kind === 'post');
  const latestPost = posts.reduce<Date | null>((m, e) => (!m || e.updatedAt > m ? e.updatedAt : m), null);
  return [
    ...(posts.length > 0 ? [{ path: `${base}/blogs`, lastmod: latestPost }] : []),
    ...entries.map((e) => ({ path: `${base}${entryPath(e.kind, e.slug)}`, lastmod: e.updatedAt })),
  ];
}

/**
 * The public pages a host is the canonical home of (only public pages: listed events, the
 * organizer pages of orgs listed there, the home and event index, and published CMS pages and
 * posts). Tenant hosts list the events whose canonical host they are and, when the org runs a
 * tenant site, its content; the marketplace lists apex events, the content of organizers without
 * a tenant site (`/o/{slug}/…`) and its own content org (`/blogs`, `/pages`).
 */
export async function sitemapPages(site: HostSite): Promise<SitemapPage[] | null> {
  if (site.kind === 'app') return null;
  if (site.kind === 'tenant') {
    const events = await sitemapListings(site.host);
    const latest = events.reduce<Date | null>((m, e) => (!m || e.updatedAt > m ? e.updatedAt : m), null);
    const org = await publicOrganizerById(site.orgId);
    return [
      { path: '/', lastmod: latest },
      ...events.map((e) => ({ path: `/events/${e.slug}`, lastmod: e.updatedAt })),
      ...(org?.tenantSite ? await contentPages(site.orgId, '') : []),
    ];
  }
  const events = await sitemapListings(null);
  const latest = events.reduce<Date | null>((m, e) => (!m || e.updatedAt > m ? e.updatedAt : m), null);
  const orgs = new Map<string, Date>();
  for (const e of events) {
    const prev = orgs.get(e.orgSlug);
    if (!prev || e.updatedAt > prev) orgs.set(e.orgSlug, e.updatedAt);
  }
  const content: SitemapPage[] = [];
  const contentOrg = await marketplaceContentOrg();
  if (contentOrg) content.push(...(await contentPages(contentOrg.orgId, '')));
  for (const slug of orgs.keys()) {
    if (slug === contentOrg?.slug) continue;
    const found = await resolveOrgSlug(slug);
    const org = found ? await publicOrganizerById(found.orgId) : null;
    if (org && !(org.tenantSite && org.primaryHost))
      content.push(...(await contentPages(org.orgId, `/o/${slug}`)));
  }
  return [
    { path: '/', lastmod: latest },
    { path: '/events', lastmod: latest },
    ...[...orgs].map(([slug, lastmod]) => ({ path: `/o/${slug}`, lastmod })),
    ...events.map((e) => ({ path: `/events/${e.slug}`, lastmod: e.updatedAt })),
    ...content,
  ];
}
