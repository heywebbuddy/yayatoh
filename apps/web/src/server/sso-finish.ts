import 'server-only';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { recordConnectionTestCommand } from '@yayatoh/sso';
import { NextResponse } from 'next/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { ports } from './ports.ts';
import { requestHost } from './request-origin.ts';
import { ownSession } from './session.ts';
import { completeSso, ssoStateCookie, takeSso } from './sso.ts';

/**
 * The IdP's answer came back (SAML ACS POST or OIDC callback GET): finish the pending sign-in or
 * test, then redirect. The state cookie is single use and goes either way. Tenant hosts never sign
 * anyone in themselves (the app host does, M1.2d).
 */
export async function finishSsoRequest(
  locale: string,
  input: { state: string | null; response: string; error: string | null; cookie: string | undefined },
  headers: Headers,
): Promise<NextResponse> {
  const here = await requestHost();
  const https = here.protocol === 'https:';
  const done = (path: string, cookies: string[] = []) => {
    const res = NextResponse.redirect(new URL(path, here.origin), 303);
    res.headers.set('cache-control', 'no-store');
    res.headers.set('referrer-policy', 'no-referrer');
    res.cookies.set(ssoStateCookie(https), '', { httpOnly: true, secure: https, path: '/', maxAge: 0 });
    for (const c of cookies) res.headers.append('set-cookie', c);
    return res;
  };
  if (here.kind === 'tenant') return new NextResponse('Not found', { status: 404 });
  const pending = await takeSso(input.state, input.cookie);
  if (!pending) return done(localizedPath(locale, '/sign-in/sso?error=expired'));
  const at = (path: string) => localizedPath(pending.locale, path);
  if (pending.intent === 'test') {
    const session = await ownSession();
    if (!session || session.userId !== pending.userId) return done(at('/sign-in'));
    const outcome = input.error
      ? ({ kind: 'tested', ok: false, reason: 'cancelled', email: null, domainVerified: false } as const)
      : await completeSso(pending, input.response, headers);
    if (outcome.kind !== 'tested') return done(at(`/o/${pending.orgSlug}/sso?test=failed`));
    await executeCommand(
      recordConnectionTestCommand,
      { connectionId: pending.connectionId, ok: outcome.ok, reason: outcome.reason },
      createCtx({
        orgId: pending.orgId,
        actor: { type: 'user', userId: session.userId },
        stepUpAt: session.stepUpAt,
        locale: pending.locale,
      }),
      ports,
    );
    const q = new URLSearchParams({ test: outcome.ok ? 'passed' : 'failed' });
    if (outcome.reason) q.set('reason', outcome.reason);
    if (outcome.ok && !outcome.domainVerified) q.set('domain', 'unverified');
    return done(at(`/o/${pending.orgSlug}/sso?${q}`));
  }
  if (input.error) return done(at('/sign-in/sso?error=cancelled'));
  const outcome = await completeSso(pending, input.response, headers);
  if (outcome.kind === 'refused') return done(at(`/sign-in/sso?error=${encodeURIComponent(outcome.reason)}`));
  if (outcome.kind !== 'signed_in') return done(at('/sign-in/sso?error=failed'));
  const next = `/o/${pending.orgSlug}`;
  if (outcome.challenge)
    return done(`${at('/sign-in')}?${new URLSearchParams({ challenge: '1', next })}`, outcome.cookies);
  return done(at(next), outcome.cookies);
}
