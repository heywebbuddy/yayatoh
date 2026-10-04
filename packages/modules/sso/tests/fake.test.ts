import { describe, expect, it } from 'vitest';
import {
  fakeIdentityProvider,
  fakeTxtResolver,
  openFakeIdpAnswer,
  publishFakeTxt,
  signFakeIdpAnswer,
} from '../src/fake.ts';
import { EXPIRED_IDP_CERTIFICATE, FAKE_IDP_CERTIFICATE } from '../src/fixtures.ts';
import type { ServiceProvider, SsoConnectionView } from '../src/ports.ts';

const SEED = 'f'.repeat(64);
const sp: ServiceProvider = {
  entityId: 'https://app.test/auth/sso/saml/metadata',
  acsUrl: 'https://app.test/auth/sso/saml/acs',
  redirectUri: 'https://app.test/auth/sso/callback',
};
const saml = (orgId: string, id: string): SsoConnectionView => ({
  id,
  orgId,
  protocol: 'saml',
  config: {
    protocol: 'saml',
    entityId: 'https://idp.acme.test/idp',
    ssoUrl: 'https://idp.acme.test/sso',
    certificate: FAKE_IDP_CERTIFICATE,
    metadataUrl: null,
  },
  clientSecret: null,
});
const oidc: SsoConnectionView = {
  id: 'conn-oidc',
  orgId: 'org-a',
  protocol: 'oidc',
  config: { protocol: 'oidc', issuer: 'https://login.acme.test', clientId: 'client-1' },
  clientSecret: 'secret',
};

const A = saml('org-a', 'conn-a');
const statement = {
  protocol: 'saml' as const,
  iss: 'https://idp.acme.test/idp',
  aud: sp.entityId,
  sub: 'sub-1',
  email: 'Jane@Acme.test',
  name: 'Jane',
  nonce: 'req-1',
};

describe('fake IdP answers', () => {
  it('verify for the connection and request they were made for', () => {
    const response = signFakeIdpAnswer(SEED, A, statement);
    expect(openFakeIdpAnswer(SEED, A, { response, nonce: 'req-1', sp })).toEqual({
      ok: true,
      assertion: { subject: 'sub-1', email: 'jane@acme.test', name: 'Jane' },
    });
  });

  it("never verify for another org's connection (key per org and connection)", () => {
    const response = signFakeIdpAnswer(SEED, A, statement);
    expect(openFakeIdpAnswer(SEED, saml('org-b', 'conn-a'), { response, nonce: 'req-1', sp })).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
    expect(openFakeIdpAnswer(SEED, saml('org-a', 'conn-b'), { response, nonce: 'req-1', sp })).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('refuse a wrong issuer, audience, request, expiry, tampering and missing email', () => {
    const open = (s: Partial<typeof statement> & { exp?: number }, nonce = 'req-1') =>
      openFakeIdpAnswer(SEED, A, { response: signFakeIdpAnswer(SEED, A, { ...statement, ...s }), nonce, sp });
    expect(open({ iss: 'https://evil.test' })).toEqual({ ok: false, reason: 'wrong_issuer' });
    expect(open({ aud: 'https://other-sp.test' })).toEqual({ ok: false, reason: 'wrong_audience' });
    expect(open({}, 'req-2')).toEqual({ ok: false, reason: 'wrong_request' });
    expect(open({ exp: Date.now() - 1 })).toEqual({ ok: false, reason: 'expired' });
    expect(open({ email: 'nope' })).toEqual({ ok: false, reason: 'no_email' });
    expect(open({ protocol: 'oidc' as never })).toEqual({ ok: false, reason: 'malformed' });
    const good = signFakeIdpAnswer(SEED, A, statement);
    const [body, sig] = good.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...statement, v: 1, exp: Date.now() + 1000, sub: 'admin' })).toString('base64url')}.${sig}`;
    expect(openFakeIdpAnswer(SEED, A, { response: forged, nonce: 'req-1', sp })).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
    expect(openFakeIdpAnswer(SEED, A, { response: `${body}`, nonce: 'req-1', sp })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('OIDC answers carry the issuer and client id', () => {
    const response = signFakeIdpAnswer(SEED, oidc, {
      ...statement,
      protocol: 'oidc',
      iss: 'https://login.acme.test',
      aud: 'client-1',
    });
    expect(openFakeIdpAnswer(SEED, oidc, { response, nonce: 'req-1', sp }).ok).toBe(true);
  });
});

describe('fake adapter', () => {
  const idp = fakeIdentityProvider({ seed: SEED, idpUrl: 'https://app.test/auth/sso/fake' });
  it('sends the browser to the fake IdP page with the request', async () => {
    const url = new URL(await idp.startUrl(A, { state: 's', nonce: 'n', sp, loginHint: 'jane@acme.test' }));
    expect(url.pathname).toBe('/auth/sso/fake');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      connection: 'conn-a',
      org: 'org-a',
      protocol: 'saml',
      state: 's',
      nonce: 'n',
      login_hint: 'jane@acme.test',
    });
  });
  it('checks certificates and OIDC discovery without network', async () => {
    const now = new Date();
    expect(await idp.check(A, now)).toEqual({ ok: true });
    expect(
      await idp.check({ ...A, config: { ...A.config, certificate: EXPIRED_IDP_CERTIFICATE } as never }, now),
    ).toEqual({
      ok: false,
      reason: 'certificate_expired',
    });
    expect(await idp.check(oidc, now)).toEqual({ ok: true });
    expect(await idp.check({ ...oidc, clientSecret: null }, now)).toEqual({
      ok: false,
      reason: 'secret_missing',
    });
    expect(
      await idp.check(
        { ...oidc, config: { ...oidc.config, issuer: 'https://login.microsoftonline.com/x' } as never },
        now,
      ),
    ).toEqual({ ok: false, reason: 'discovery_failed' });
  });
  it('fake DNS answers published records only', async () => {
    publishFakeTxt('_yayatoh-sso.unit.test', 'yayatoh-verification=abc');
    expect(await fakeTxtResolver('_YAYATOH-SSO.unit.test.')).toEqual([['yayatoh-verification=abc']]);
    publishFakeTxt('_yayatoh-sso.unit.test', null);
    await expect(fakeTxtResolver('_yayatoh-sso.unit.test')).rejects.toMatchObject({ code: 'ENODATA' });
  });
});
