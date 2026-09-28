import { NextResponse } from 'next/server';
import { dropSeatStreams } from '@/server/seat-stream.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: drop every open live-seat stream, as a network blip would (browser tests check
 * that pickers reconnect and catch up). 404 unless dev personas are enabled; never in production.
 */
export async function POST() {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ dropped: dropSeatStreams() });
}
