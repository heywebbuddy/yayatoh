import { displaySession, LIVE_CHANNEL } from '@yayatoh/engagement';
import { appTokenSecret, type ResolvedChannel, realtimeChannelName } from '@yayatoh/platform';
import type { NextRequest } from 'next/server';
import { channelParam, REALTIME_CHANNELS, realtimeStreamResponse, streamKey } from '@/server/realtime.ts';

export const dynamic = 'force-dynamic';

/**
 * The big screen's live stream (M5.7a): the session's public channel, for whoever holds its signed
 * display link. The token is the only credential (no sign-in on a projector); its org and session
 * come from the signature, and a rotated link is refused (404, like an unknown one). Same stream
 * as the audience's: resume by Last-Event-ID or a snapshot, heartbeats, rate and stream limits.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = await displaySession(channelParam(token), appTokenSecret());
  if (!target) return new Response(null, { status: 404 });
  const channel = REALTIME_CHANNELS.resolve(
    realtimeChannelName(LIVE_CHANNEL, target.orgId, target.eventId, target.sessionId),
  ) as ResolvedChannel;
  return realtimeStreamResponse(
    req,
    { ok: true, channel, as: 'public', who: `display:${target.sessionId}` },
    { rateBucket: `engagement-display:${target.sessionId}:${streamKey(token)}` },
  );
}
