import { latest, sitemapIndexXml } from '@/lib/seo/sitemap.ts';
import { hostSite, originOf, toPrimary } from '@/server/host-site.ts';
import { sitemapPages } from '@/server/sitemap-pages.ts';

/** The host's sitemap index: one sitemap per locale (roadmap §7.7). */
export async function GET(req: Request) {
  const site = await hostSite(req);
  if (!site) return new Response('Not found', { status: 404 });
  if (site.kind === 'tenant' && site.primaryHost && site.primaryHost !== site.host)
    return toPrimary(req, site.primaryHost);
  const pages = await sitemapPages(site);
  if (!pages) return new Response('Not found', { status: 404 });
  return new Response(sitemapIndexXml(originOf(req), latest(pages)), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
}
