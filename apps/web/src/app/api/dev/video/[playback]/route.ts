import { fakePlaybackCheck, videoProviders } from '@yayatoh/virtual';
import { type NextRequest, NextResponse } from 'next/server';
import '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: the fake video provider's "CDN" (M6.9a). Answers like Mux's playback endpoint
 * would: 200 for an authentic, unexpired token for this very playback id, 403 otherwise. No video
 * is served; the player shows a test pattern. 404 unless dev auth is on and a fake provider is
 * registered. M6.10a: both fakes (Mux and Cloudflare Stream) answer here; each accepts only its own
 * tokens.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ playback: string }> }) {
  const fakes = videoProviders().filter((p) => p.sandbox);
  if (!devAuthEnabled() || fakes.length === 0) return new NextResponse(null, { status: 404 });
  const { playback } = await params;
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const now = new Date();
  const verdict = fakes.some((p) => fakePlaybackCheck(p, playback, token, now) === 'ok') ? 'ok' : 'forbidden';
  return NextResponse.json(
    { playback: verdict },
    { status: verdict === 'ok' ? 200 : 403, headers: { 'cache-control': 'no-store' } },
  );
}
