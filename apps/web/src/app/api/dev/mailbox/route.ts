import { type NextRequest, NextResponse } from 'next/server';
import { devLastCode } from '@/server/auth.ts';
import { devAuthEnabled } from '@/server/session.ts';

/** Development only: the last one-time code "emailed" to an address (persona tools, e2e). */
export async function GET(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const to = req.nextUrl.searchParams.get('to') ?? '';
  return NextResponse.json({ code: await devLastCode(to) }, { headers: { 'cache-control': 'no-store' } });
}
