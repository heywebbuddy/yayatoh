import { currentVideoProvider, fakePlaybackCheck } from '@yayatoh/virtual';
import { type NextRequest, NextResponse } from 'next/server';
import '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: the fake video provider's "CDN" (M6.9a). Answers like Mux's playback endpoint
 * would: 200 for an authentic, unexpired token for this very playback id, 403 otherwise. No video
 * is served; the player shows a test pattern. 404 unless dev auth is on and the provider is fake.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ playback: string }> }) {
  const provider = currentVideoProvider();
  if (!devAuthEnabled() || provider?.name !== 'fake') return new NextResponse(null, { status: 404 });
  const { playback } = await params;
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const verdict = fakePlaybackCheck(provider, playback, token, new Date());
  return NextResponse.json(
    { playback: verdict },
    { status: verdict === 'ok' ? 200 : 403, headers: { 'cache-control': 'no-store' } },
  );
}
