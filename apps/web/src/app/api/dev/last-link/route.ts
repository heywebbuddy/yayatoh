import { type NextRequest, NextResponse } from 'next/server';
import { devLastLink } from '@/server/auth.ts';
import { devAuthEnabled } from '@/server/session.ts';

/** Development only: the last password-reset link "emailed" to an address (e2e, M1.2f). */
export async function GET(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const to = req.nextUrl.searchParams.get('to') ?? '';
  return NextResponse.json({ url: await devLastLink(to) }, { headers: { 'cache-control': 'no-store' } });
}
