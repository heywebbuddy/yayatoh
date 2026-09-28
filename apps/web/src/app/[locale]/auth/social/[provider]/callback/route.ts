import {
  createSocialUser,
  isSocialProvider,
  linkSocialAccount,
  resolveSocialSignIn,
  startLinkProof,
} from '@yayatoh/auth';
import { type NextRequest, NextResponse } from 'next/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { authMailer, getAuth } from '@/server/auth.ts';
import { requestHost } from '@/server/request-origin.ts';
import { ownSession } from '@/server/session.ts';
import { afterSignIn, challengeUrl, type SignInTarget, signInUrl } from '@/server/sign-in-finish.ts';
import {
  LINK_PROOF_MAX_AGE_S,
  linkProofCookie,
  socialProvider,
  socialRedirectUri,
  socialStateCookie,
  takeSocial,
} from '@/server/social.ts';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ locale: string; provider: string }> };

/**
 * The provider sends the browser back here (M1.2f). The state must match this browser's cookie
 * (no login CSRF) and is single use. Then, for a sign-in: an identity already linked signs in; a
 * new verified email creates the account; an email that already has an account must be proved
 * with a code sent to it first (no pre-hijack takeover). People with two-step verification still
 * answer the second step. For account security's "Link": the provider is linked to the person who
 * started it, if they are still the one signed in here.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { locale, provider } = await params;
  const here = await requestHost();
  const https = here.protocol === 'https:';
  const q = req.nextUrl.searchParams;
  const abs = (path: string) => (/^https?:\/\//.test(path) ? path : new URL(path, here.origin).toString());
  const done = (path: string, cookies: string[] = []) => {
    const res = NextResponse.redirect(abs(path), 303);
    for (const c of cookies) res.headers.append('set-cookie', c);
    res.headers.set('cache-control', 'no-store');
    res.headers.set('referrer-policy', 'no-referrer');
    res.cookies.set(socialStateCookie(https), '', {
      httpOnly: true,
      secure: https,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return res;
  };
  if (here.kind === 'tenant' || !isSocialProvider(provider))
    return new NextResponse('Not found', { status: 404 });
  const pending = await takeSocial(
    provider,
    q.get('state'),
    req.cookies.get(socialStateCookie(https))?.value,
  );
  const failed = localizedPath(locale, '/sign-in?social=failed');
  if (!pending) return done(failed);
  const target: SignInTarget = { locale: pending.locale, next: pending.next, handoff: pending.handoff };
  const security = (outcome: string) =>
    localizedPath(pending.locale, `/account/security?social=${outcome}&provider=${provider}`);
  if (q.get('error'))
    return done(
      pending.intent === 'link' ? security('cancelled') : signInUrl(target, { social: 'cancelled' }),
    );
  const adapter = socialProvider(provider);
  const profile = adapter
    ? await adapter
        .exchange({
          code: (q.get('code') ?? '').slice(0, 4096),
          codeVerifier: pending.codeVerifier,
          nonce: pending.nonce,
          redirectUri: socialRedirectUri(provider),
          user: q.get('user'),
        })
        .catch(() => null)
    : null;
  if (!profile)
    return done(pending.intent === 'link' ? security('failed') : signInUrl(target, { social: 'failed' }));

  if (pending.intent === 'link') {
    const session = await ownSession();
    if (!session || session.userId !== pending.userId) return done(security('failed'));
    return done(security(await linkSocialAccount(getAuth(), session.userId, profile)));
  }

  const resolved = await resolveSocialSignIn(profile);
  if (resolved.kind === 'refused') return done(signInUrl(target, { social: resolved.reason }));
  if (resolved.kind === 'prove_email') {
    const id = await startLinkProof(getAuth(), authMailer, {
      userId: resolved.userId,
      email: resolved.email,
      profile,
    });
    const qs = new URLSearchParams({ provider });
    if (target.handoff) {
      qs.set('return', target.handoff.returnUrl);
      qs.set('state', target.handoff.state);
    } else qs.set('next', target.next);
    const res = done(`${localizedPath(pending.locale, '/sign-in/link')}?${qs}`);
    res.cookies.set(linkProofCookie(https), id, {
      httpOnly: true,
      secure: https,
      sameSite: 'lax',
      path: '/',
      maxAge: LINK_PROOF_MAX_AGE_S,
    });
    return res;
  }
  const userId = resolved.kind === 'linked' ? resolved.userId : await createSocialUser(getAuth(), profile);
  const signed = await getAuth().api.socialSession({
    body: { userId },
    headers: req.headers,
    asResponse: true,
  });
  if (!signed.ok) return done(signInUrl(target, { social: 'failed' }));
  const cookies = signed.headers.getSetCookie();
  const { challenge } = (await signed.json()) as { challenge: boolean };
  if (challenge) return done(challengeUrl(target), cookies);
  return done(await afterSignIn(userId, target), cookies);
}

/** Apple answers with a form POST (response_mode=form_post): continue as a GET with the same fields. */
export async function POST(req: NextRequest, { params }: Params) {
  const { locale, provider } = await params;
  const here = await requestHost();
  const form = await req.formData();
  const q = new URLSearchParams();
  for (const k of ['code', 'state', 'error', 'user']) {
    const v = form.get(k);
    if (typeof v === 'string') q.set(k, v.slice(0, 4096));
  }
  const url = new URL(`${localizedPath(locale, `/auth/social/${provider}/callback`)}?${q}`, here.origin);
  return NextResponse.redirect(url, 303);
}
