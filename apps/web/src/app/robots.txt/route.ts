import { robotsTxt } from '@/lib/seo/robots.ts';
import { hostSite, originOf, toPrimary } from '@/server/host-site.ts';

/** robots.txt per host (roadmap §4.2, §7.7). */
export async function GET(req: Request) {
  const site = await hostSite(req);
  if (!site) return new Response('Not found', { status: 404 });
  if (site.kind === 'tenant' && site.primaryHost && site.primaryHost !== site.host)
    return toPrimary(req, site.primaryHost);
  return new Response(robotsTxt(site.kind, originOf(req)), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
