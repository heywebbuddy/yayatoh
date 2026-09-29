import { NextResponse } from 'next/server';
import { dropRealtimeStreams } from '@/server/realtime.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: drop every open realtime stream (seat maps and every other channel), as a network
 * blip would (browser tests check that clients reconnect and catch up). 404 unless dev personas
 * are enabled; never in production.
 */
export async function POST() {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ dropped: dropRealtimeStreams() });
}
