import { displayScreen, GIVING_SCREEN_CHANNEL } from '@yayatoh/donations';
import { appTokenSecret, type ResolvedChannel, realtimeChannelName } from '@yayatoh/platform';
import type { NextRequest } from 'next/server';
import { channelParam, REALTIME_CHANNELS, realtimeStreamResponse, streamKey } from '@/server/realtime.ts';

export const dynamic = 'force-dynamic';

/**
 * The live giving screen's stream (M4.8d): the event's screen channel, for whoever holds its signed
 * link (no sign-in on a projector). Org and event come from the signature; a replaced link is
 * refused (404, like an unknown one). Same stream as every channel: resume by Last-Event-ID or a
 * snapshot (the reconnect snapshot is the whole thermometer), heartbeats, rate and stream limits.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = await displayScreen(channelParam(token), appTokenSecret());
  if (!target) return new Response(null, { status: 404 });
  const channel = REALTIME_CHANNELS.resolve(
    realtimeChannelName(GIVING_SCREEN_CHANNEL, target.orgId, target.eventId),
  ) as ResolvedChannel;
  return realtimeStreamResponse(
    req,
    { ok: true, channel, as: 'public', who: `screen:${target.eventId}` },
    { rateBucket: `giving-screen:${target.eventId}:${streamKey(token)}` },
  );
}
