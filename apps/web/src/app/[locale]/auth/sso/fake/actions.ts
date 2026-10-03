'use server';

import { connectionView, expectedParties, fakeIdpSubject, signFakeIdpAnswer, ssoRuntime } from '@yayatoh/sso';
import { z } from 'zod';
import { serviceProvider } from '@/server/sso.ts';
import { fakeIdpSeed } from '@/server/sso-seed.ts';

export type FakeIdpAnswer =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly error: 'invalid_email' | 'unknown' }
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'post'; readonly url: string; readonly fields: Readonly<Record<string, string>> };

const Input = z.object({
  org: z.uuid(),
  connection: z.uuid(),
  state: z.string().max(100),
  nonce: z.string().max(100),
  email: z.string().trim().max(320),
  name: z.string().trim().max(200),
  cancel: z.boolean(),
});

/**
 * The fake IdP (dev, preview and CI only; M6.5a) answers as the org's IdP would: a signed SAML
 * response posted to our ACS, or an OIDC code sent to our redirect URI. Refused outside the fake.
 */
export async function fakeIdpAnswerAction(_prev: FakeIdpAnswer, form: FormData): Promise<FakeIdpAnswer> {
  const seed = fakeIdpSeed();
  if (!seed || ssoRuntime().idp?.kind !== 'fake') return { kind: 'error', error: 'unknown' };
  const parsed = Input.safeParse({
    org: form.get('org'),
    connection: form.get('connection'),
    state: form.get('state'),
    nonce: form.get('nonce'),
    email: form.get('email') ?? '',
    name: form.get('name') ?? '',
    cancel: form.get('intent') === 'cancel',
  });
  if (!parsed.success) return { kind: 'error', error: 'unknown' };
  const i = parsed.data;
  const conn = await connectionView(i.org, i.connection);
  if (!conn) return { kind: 'error', error: 'unknown' };
  const sp = serviceProvider();
  if (!i.cancel && !z.email().safeParse(i.email).success) return { kind: 'error', error: 'invalid_email' };
  if (conn.protocol === 'oidc') {
    const u = new URL(sp.redirectUri);
    u.searchParams.set('state', i.state);
    if (i.cancel) u.searchParams.set('error', 'access_denied');
    else
      u.searchParams.set(
        'code',
        signFakeIdpAnswer(seed, conn, {
          protocol: 'oidc',
          ...expectedParties(conn, sp),
          sub: fakeIdpSubject(i.email),
          email: i.email,
          name: i.name || null,
          nonce: i.nonce,
        }),
      );
    return { kind: 'redirect', url: u.toString() };
  }
  return {
    kind: 'post',
    url: sp.acsUrl,
    fields: i.cancel
      ? { RelayState: i.state, error: 'cancelled' }
      : {
          RelayState: i.state,
          SAMLResponse: signFakeIdpAnswer(seed, conn, {
            protocol: 'saml',
            ...expectedParties(conn, sp),
            sub: fakeIdpSubject(i.email),
            email: i.email,
            name: i.name || null,
            nonce: i.nonce,
          }),
        },
  };
}
