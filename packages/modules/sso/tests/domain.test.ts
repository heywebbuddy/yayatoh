import { describe, expect, it } from 'vitest';
import { certificateInfo, certificateProblem, parseSamlMetadata, toPem } from '../src/domain/config.ts';
import { emailDomain, normalizeDomain, txtMatches, verificationRecord } from '../src/domain/domains.ts';
import { mappedRole } from '../src/domain/roles.ts';
import { EXPIRED_IDP_CERTIFICATE, FAKE_IDP_CERTIFICATE, fakeIdpMetadata } from '../src/fixtures.ts';

describe('SAML metadata', () => {
  it('reads the entity id, the redirect sign-in URL and the signing certificate', () => {
    const r = parseSamlMetadata(fakeIdpMetadata('https://idp.acme.test/idp'));
    expect(r).toEqual({
      entityId: 'https://idp.acme.test/idp',
      ssoUrl: 'https://idp.acme.test/idp/sso/saml',
      certificate: toPem(FAKE_IDP_CERTIFICATE),
    });
  });

  it('prefers HTTP-Redirect and falls back to HTTP-POST', () => {
    const xml = fakeIdpMetadata('https://idp.acme.test/x').replace(
      /<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"[^>]*>/,
      '',
    );
    const r = parseSamlMetadata(xml);
    expect('error' in r ? r.error : r.ssoUrl).toBe('https://idp.acme.test/x/sso/saml');
  });

  it('refuses documents with a DTD or entities (no XXE), without an IdP descriptor, URL or certificate', () => {
    const ok = fakeIdpMetadata('https://idp.acme.test/x');
    expect(parseSamlMetadata(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${ok}`)).toEqual({
      error: 'invalid_metadata',
    });
    expect(parseSamlMetadata('<EntityDescriptor entityID="x"></EntityDescriptor>')).toEqual({
      error: 'invalid_metadata',
    });
    expect(parseSamlMetadata(ok.replace(/<md:SingleSignOnService[^>]*>/g, ''))).toEqual({
      error: 'no_sso_url',
    });
    expect(parseSamlMetadata(ok.replace(/<md:KeyDescriptor[\s\S]*<\/md:KeyDescriptor>/, ''))).toEqual({
      error: 'no_certificate',
    });
    expect(parseSamlMetadata('x'.repeat(200_001))).toEqual({ error: 'too_large' });
  });

  it('ignores encryption-only keys', () => {
    const xml = fakeIdpMetadata('https://idp.acme.test/x').replace('use="signing"', 'use="encryption"');
    expect(parseSamlMetadata(xml)).toEqual({ error: 'no_certificate' });
  });
});

describe('certificates', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  it('reads subject, expiry and fingerprint, and says what is wrong', () => {
    const info = certificateInfo(FAKE_IDP_CERTIFICATE);
    expect(info?.subject).toContain('Yayatoh Fake IdP');
    expect(info?.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(certificateProblem(FAKE_IDP_CERTIFICATE, now)).toBeNull();
    expect(certificateProblem(EXPIRED_IDP_CERTIFICATE, now)).toBe('certificate_expired');
    expect(certificateProblem('not a certificate', now)).toBe('certificate_invalid');
    expect(certificateInfo('nope')).toBeNull();
  });
  it('accepts a bare base64 body', () => {
    const body = FAKE_IDP_CERTIFICATE.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, '');
    expect(certificateProblem(body, now)).toBeNull();
  });
});

describe('domains', () => {
  it('normalizes domains, addresses and URLs', () => {
    expect(normalizeDomain(' Acme.COM ')).toBe('acme.com');
    expect(normalizeDomain('jane@Acme.com')).toBe('acme.com');
    expect(normalizeDomain('https://acme.com/login')).toBe('acme.com');
    expect(normalizeDomain('acme.com.')).toBe('acme.com');
  });
  it('refuses single labels, IP addresses, bad names and the platform', () => {
    for (const bad of [
      'localhost',
      '10.0.0.1',
      '-acme.com',
      'ac me.com',
      'yayatoh.com',
      'x.yayatoh.events',
      'a.b',
    ])
      expect(normalizeDomain(bad)).toBeNull();
  });
  it('takes the domain of an address', () => {
    expect(emailDomain('Jane.Doe@Sub.Acme.com')).toBe('sub.acme.com');
    expect(emailDomain('no-at-sign')).toBeNull();
  });
  it('matches the TXT record (split strings joined)', () => {
    const rec = verificationRecord('acme.com', 'tok');
    expect(rec).toEqual({ name: '_yayatoh-sso.acme.com', value: 'yayatoh-verification=tok' });
    expect(txtMatches([['v=spf1 -all'], ['yayatoh-verif', 'ication=tok']], 'tok')).toBe(true);
    expect(txtMatches([['yayatoh-verification=other']], 'tok')).toBe(false);
    expect(txtMatches([], 'tok')).toBe(false);
  });
});

describe('group role mapping', () => {
  it('takes the strongest mapped role and never owner', () => {
    expect(mappedRole(['viewer', 'manager', null])).toBe('manager');
    expect(mappedRole(['admin', 'manager'])).toBe('admin');
    expect(mappedRole([null, 'owner', 'collaborator'])).toBeNull();
    expect(mappedRole([])).toBeNull();
  });
});
