'use server';

import { ssoForEmail } from '@yayatoh/sso';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { limitAction } from '@/server/rate-limit.ts';
import { requestHost } from '@/server/request-origin.ts';
import { beginSso, SSO_STATE_MAX_AGE_S, ssoAvailable, ssoStateCookie } from '@/server/sso.ts';

export type SsoStartState = {
  readonly error: 'invalid_email' | 'no_sso' | 'rate_limited' | 'unavailable' | null;
};

const Email = z.email().max(320);

/**
 * "Sign in with single sign-on" (M6.5a): the address's verified domain names the org and its
 * connection; the browser goes to that IdP with a state only this browser's cookie holds.
 * Limited like sign-ins (per device, per address), so domains can't be probed in bulk.
 */
export async function startSsoAction(_prev: SsoStartState, form: FormData): Promise<SsoStartState> {
  const here = await requestHost();
  if (here.kind === 'tenant' || !ssoAvailable()) return { error: 'unavailable' };
  const parsed = Email.safeParse(
    String(form.get('email') ?? '')
      .trim()
      .toLowerCase(),
  );
  if (!parsed.success) return { error: 'invalid_email' };
  const limit = await limitAction('signIn', { identity: parsed.data, scope: 'sso' });
  if (!limit.allowed) return { error: 'rate_limited' };
  const target = await ssoForEmail(parsed.data);
  if (!target) return { error: 'no_sso' };
  const started = await beginSso(
    {
      orgId: target.orgId,
      orgSlug: target.orgSlug,
      connectionId: target.connectionId,
      locale: await getLocale(),
      intent: 'sign_in',
      userId: null,
    },
    parsed.data,
  );
  if (!started) return { error: 'unavailable' };
  const https = here.protocol === 'https:';
  (await cookies()).set(ssoStateCookie(https), started.state, {
    httpOnly: true,
    secure: https,
    // The SAML IdP posts back from its own site: the cookie must travel on that POST (https only).
    sameSite: https ? 'none' : 'lax',
    path: '/',
    maxAge: SSO_STATE_MAX_AGE_S,
  });
  redirect(started.url);
}
