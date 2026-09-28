import { devExpireGuestChallenges } from '@yayatoh/orders';
import { type NextRequest, NextResponse } from 'next/server';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Development and e2e only (M1.5f): expire an address's live guest codes and links now
 * (`POST ?to=…&expire=1`), so browser tests see the expired-code message without waiting ten
 * minutes. 404 unless dev personas are enabled; never in production. Read codes through
 * `/api/dev/last-code`.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const to = req.nextUrl.searchParams.get('to') ?? '';
  if (!to || req.nextUrl.searchParams.get('expire') !== '1') return new NextResponse(null, { status: 400 });
  return NextResponse.json({ expired: await devExpireGuestChallenges(to) });
}
