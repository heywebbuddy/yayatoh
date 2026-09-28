import { type NextRequest, NextResponse } from 'next/server';
import { tenantNextPath } from '@/lib/handoff.ts';
import { requestHost } from '@/server/request-origin.ts';
import { endThisHostSession } from '@/server/session.ts';

export const dynamic = 'force-dynamic';

/**
 * Sign out on this host only (M1.2d): a tenant site's "Sign out" ends its own session; the app
 * host and other sites keep theirs ("Sign out everywhere" is on the account's security page).
 * A plain form POST from this same origin, then a full page load back through host routing.
 */
export async function POST(req: NextRequest) {
  const here = await requestHost();
  if (req.headers.get('origin') !== here.origin) return new NextResponse('Forbidden', { status: 403 });
  await endThisHostSession();
  const form = await req.formData().catch(() => new FormData());
  const back = tenantNextPath(String(form.get('next') ?? ''), '/');
  const res = NextResponse.redirect(new URL(back, here.origin), 303);
  res.headers.set('cache-control', 'no-store');
  return res;
}
