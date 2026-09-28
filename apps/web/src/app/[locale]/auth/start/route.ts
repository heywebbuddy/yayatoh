import { type NextRequest, NextResponse } from 'next/server';
import {
  HANDOFF_STATE_MAX_AGE_S,
  handoffStateCookie,
  newHandoffState,
  tenantNextPath,
} from '@/lib/handoff.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { requestHost } from '@/server/request-origin.ts';

export const dynamic = 'force-dynamic';

/**
 * Central login, the first step (M1.2d, roadmap §4.2): a tenant host never signs anyone in
 * itself. "Sign in" there (`/sign-in` is rewritten here by the proxy) goes to the app host's
 * sign-in with this host's URL to come back to and a state value, also kept in a host-only cookie
 * here; the app host then sends the person back with a one-time code (`/auth/handoff`) bound to
 * this host and that state. Only tenant hosts start a handoff.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const here = await requestHost();
  if (here.kind !== 'tenant') return new NextResponse('Not found', { status: 404 });
  const https = here.protocol === 'https:';
  const back = new URL(
    tenantNextPath(req.nextUrl.searchParams.get('next'), localizedPath(locale, '/')),
    here.origin,
  );
  const state = newHandoffState();
  const to = new URL(
    localizedPath(locale, '/sign-in'),
    process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  );
  to.searchParams.set('return', back.toString());
  to.searchParams.set('state', state);
  const res = NextResponse.redirect(to, 303);
  res.headers.set('cache-control', 'no-store');
  res.cookies.set(handoffStateCookie(https), state, {
    httpOnly: true,
    secure: https,
    sameSite: 'lax',
    path: '/',
    maxAge: HANDOFF_STATE_MAX_AGE_S,
  });
  return res;
}
