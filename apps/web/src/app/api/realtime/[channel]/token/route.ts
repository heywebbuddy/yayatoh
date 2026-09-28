import { ablyTokenRequest, realtimeProvider } from '@yayatoh/platform';
import { DEVICE_COOKIE } from '@yayatoh/platform/security';
import { type NextRequest, NextResponse } from 'next/server';
import { authorizeRealtime, channelParam, streamKey } from '@/server/realtime.ts';
import { realtimeHostOrg } from '@/server/realtime-host.ts';

export const dynamic = 'force-dynamic';

/**
 * Ably token auth for one channel (M3.1b; only with `REALTIME_PROVIDER=ably`, otherwise 404).
 * The same authorization as the SSE stream, then a TokenRequest signed here whose capability is
 * `subscribe` on exactly that channel: the browser can never widen it to another org's channels.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const apiKey = process.env.ABLY_API_KEY;
  if (realtimeProvider() !== 'ably' || !apiKey) return new NextResponse(null, { status: 404 });
  const { channel } = await params;
  const host = await realtimeHostOrg(req);
  if (host === null) return new NextResponse(null, { status: 404 });
  const attach = await authorizeRealtime(req, channelParam(channel), {
    ...(host === 'any' ? {} : { hostOrgId: host.orgId }),
    publicWho: req.cookies.get(DEVICE_COOKIE)?.value ?? null,
  });
  if (!attach.ok) return new NextResponse(null, { status: attach.status });
  const token = ablyTokenRequest({
    apiKey,
    channels: [attach.channel.name],
    clientId: streamKey(attach.who),
    ttlMs: 3_600_000,
  });
  return NextResponse.json(token, { headers: { 'cache-control': 'no-store' } });
}
