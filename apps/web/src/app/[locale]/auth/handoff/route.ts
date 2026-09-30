import { type NextRequest, NextResponse } from 'next/server';
import { handoffStateCookie } from '@/lib/handoff.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { getAuth } from '@/server/auth.ts';
import { requestHost } from '@/server/request-origin.ts';

export const dynamic = 'force-dynamic';

/**
 * Central login, the last step (M1.2d): this host redeems a one-time code from the app host for
 * its own session. The code must be for this host, unused, under 60 seconds old and (for a
 * tenant's "Sign in") issued to this browser's sign-in state; any other attempt is refused,
 * audited, and lands on one generic "can't be used" page. The session cookie is host-only
 * (`__Host-` on HTTPS, no Domain), so it works nowhere else.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const here = await requestHost();
  const https = here.protocol === 'https:';
  const stateName = handoffStateCookie(https);
  const code = req.nextUrl.searchParams.get('code') ?? '';
  const res = await getAuth().api.redeemHandoff({
    body: {
      code: code.slice(0, 100),
      host: req.headers.get('host') ?? '',
      state: req.cookies.get(stateName)?.value ?? null,
    },
    headers: req.headers,
    asResponse: true,
  });
  let target = new URL(localizedPath(locale, '/auth/error'), here.origin);
  if (res.ok) {
    const body = (await res.json()) as { returnPath?: unknown };
    if (typeof body.returnPath === 'string') target = new URL(body.returnPath, here.origin);
  }
  const out = NextResponse.redirect(target, 303);
  if (res.ok) for (const c of res.headers.getSetCookie()) out.headers.append('set-cookie', c);
  out.headers.set('cache-control', 'no-store');
  out.headers.set('referrer-policy', 'no-referrer');
  out.cookies.set(stateName, '', { httpOnly: true, secure: https, sameSite: 'lax', path: '/', maxAge: 0 });
  return out;
}
