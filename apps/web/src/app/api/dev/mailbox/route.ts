import { readDevMailbox } from '@yayatoh/notifications';
import { type NextRequest, NextResponse } from 'next/server';
import { devAuthEnabled } from '@/server/session.ts';

/** Dev/CI only: messages the dev mailbox captured, newest first (`?to=` filters by address). */
export async function GET(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const to = req.nextUrl.searchParams.get('to') ?? undefined;
  return NextResponse.json(readDevMailbox({ to, limit: 50 }));
}
