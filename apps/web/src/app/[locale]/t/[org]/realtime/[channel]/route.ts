import { DEVICE_COOKIE } from '@yayatoh/platform/security';
import type { NextRequest } from 'next/server';
import { channelParam, realtimeRoute } from '@/server/realtime.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

export const dynamic = 'force-dynamic';

/**
 * A realtime channel on a tenant site (M3.1b): the proxy rewrites `{host}/realtime/{channel}`
 * here with the host's org, and only that org's channels may be attached (another org's: 403).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ org: string; channel: string }> },
) {
  const { org, channel } = await params;
  const orgId = tenantOrgParam(org);
  if (!orgId) return new Response(null, { status: 404 });
  return realtimeRoute(req, channelParam(channel), {
    hostOrgId: orgId,
    publicWho: req.cookies.get(DEVICE_COOKIE)?.value ?? null,
  });
}
