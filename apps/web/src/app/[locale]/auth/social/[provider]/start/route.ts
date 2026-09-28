import { isSocialProvider } from '@yayatoh/auth';
import { type NextRequest, NextResponse } from 'next/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { requestHost } from '@/server/request-origin.ts';
import { safeNext } from '@/server/sign-in-finish.ts';
import { beginSocial, SOCIAL_STATE_MAX_AGE_S, socialStateCookie } from '@/server/social.ts';
import { verifiedTenantReturn } from '@/server/tenant-return.ts';

export const dynamic = 'force-dynamic';

/**
 * "Continue with Google/Apple" on the app host's sign-in (M1.2f): remember where to go (the
 * console, or a tenant site through the M1.2d handoff), then send the browser to the provider.
 * Tenant hosts never sign anyone in themselves.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ locale: string; provider: string }> },
) {
  const { locale, provider } = await params;
  const here = await requestHost();
  if (here.kind === 'tenant' || !isSocialProvider(provider))
    return new NextResponse('Not found', { status: 404 });
  const form = await req.formData();
  const returnUrl = String(form.get('return') ?? '');
  const state = String(form.get('state') ?? '');
  const ret = state ? await verifiedTenantReturn(returnUrl) : null;
  const started = await beginSocial({
    provider,
    locale,
    intent: 'sign_in',
    userId: null,
    next: safeNext(String(form.get('next') ?? '')),
    handoff: ret && /^[A-Za-z0-9_-]{43}$/.test(state) ? { returnUrl: ret.origin + ret.path, state } : null,
  });
  if (!started)
    return NextResponse.redirect(
      new URL(`${localizedPath(locale, '/sign-in')}?social=unavailable`, here.origin),
      303,
    );
  const res = NextResponse.redirect(started.url, 303);
  res.headers.set('cache-control', 'no-store');
  const https = here.protocol === 'https:';
  res.cookies.set(socialStateCookie(https), started.state, {
    httpOnly: true,
    secure: https,
    sameSite: 'lax',
    path: '/',
    maxAge: SOCIAL_STATE_MAX_AGE_S,
  });
  return res;
}
