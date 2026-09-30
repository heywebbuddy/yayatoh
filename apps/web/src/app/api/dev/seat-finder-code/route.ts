import { checkoutTarget } from '@yayatoh/events';
import { devFinderCode } from '@yayatoh/seating';
import { type NextRequest, NextResponse } from 'next/server';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/preview mail peek for browser tests: the latest seat finder code mailed to an address for an
 * event (the worker's console mailer prints it where Playwright can't read it). 404 unless dev
 * personas are enabled; never available in production.
 */
export async function GET(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const slug = req.nextUrl.searchParams.get('event') ?? '';
  const email = req.nextUrl.searchParams.get('email') ?? '';
  const target = slug ? await checkoutTarget(slug) : null;
  const found = target && email ? await devFinderCode(target.orgId, target.eventId, email) : null;
  if (!found) return NextResponse.json({ code: null }, { status: 404 });
  return NextResponse.json({ code: found.code });
}
