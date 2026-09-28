import { trackedRedirect } from '@/server/redirector.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

/**
 * Tracked links on a tenant host (M3.8a): the proxy rewrites `/r/{code}` here with the host's org
 * as the route param, so only that org's links resolve (another org's code is a 404).
 */
async function handle(
  request: Request,
  { params }: { params: Promise<{ locale: string; org: string; code: string }> },
) {
  const { locale, org, code } = await params;
  const orgId = tenantOrgParam(org);
  if (!orgId) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return trackedRedirect(request, decodeURIComponent(code), locale, orgId);
}

export const GET = handle;
export const HEAD = handle;
