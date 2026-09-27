import { LOCALES } from '@yayatoh/contracts';
import { localeSitemapXml } from '@/lib/seo/sitemap.ts';
import { hostSite, originOf, toPrimary } from '@/server/host-site.ts';
import { sitemapPages } from '@/server/sitemap-pages.ts';

/** One locale's sitemap (`/sitemaps/{locale}.xml`) with hreflang alternates and lastmod. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const locale = file.replace(/\.xml$/, '');
  if (!file.endsWith('.xml') || !(LOCALES as readonly string[]).includes(locale))
    return new Response('Not found', { status: 404 });
  const site = await hostSite(req);
  if (!site) return new Response('Not found', { status: 404 });
  if (site.kind === 'tenant' && site.primaryHost && site.primaryHost !== site.host)
    return toPrimary(req, site.primaryHost);
  const pages = await sitemapPages(site);
  if (!pages) return new Response('Not found', { status: 404 });
  return new Response(localeSitemapXml(originOf(req), locale, pages), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
}
