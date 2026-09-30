import { DEVICE_COOKIE } from '@yayatoh/platform/security';
import type { NextRequest } from 'next/server';
import { channelParam, realtimeRoute } from '@/server/realtime.ts';
import { realtimeHostOrg } from '@/server/realtime-host.ts';

export const dynamic = 'force-dynamic';

/**
 * A realtime channel as Server-Sent Events (M3.1b): `/api/realtime/{channel}`, where the channel
 * is its org-scoped wire name (`org:{org}:event:{event}:checkins`, …). Members attach with their
 * session, check-in devices with their bearer token, anyone to a public channel of a public
 * event. Another org's channel is refused (403) whatever the caller presents; on a tenant host,
 * so is any channel of another org than the site's.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  const host = await realtimeHostOrg(req);
  if (host === null) return new Response(null, { status: 404 });
  return realtimeRoute(req, channelParam(channel), {
    ...(host === 'any' ? {} : { hostOrgId: host.orgId }),
    publicWho: req.cookies.get(DEVICE_COOKIE)?.value ?? null,
  });
}
