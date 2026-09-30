import { describe, expect, it } from 'vitest';
import {
  deviceLabel,
  FAKE_CODE_TTL_MS,
  fakeRelayEmail,
  fakeSocialProvider,
  fakeSubject,
  hashRefreshToken,
  isPrivateRelayEmail,
  isRefreshToken,
  isSocialProvider,
  newRefreshToken,
  openFakeCode,
  parseTrustedDeviceCookie,
  signFakeCode,
  trustedDeviceCookie,
} from '../src/index.ts';

const SECRET = 'a'.repeat(64);
const consent = {
  provider: 'google' as const,
  subject: 'fake-google-123',
  email: 'Tess@Example.test',
  emailVerified: true,
  name: 'Tess',
  nonce: 'n-1',
  redirectUri: 'http://localhost:3000/auth/social/google/callback',
};
const expect1 = { provider: 'google' as const, nonce: 'n-1', redirectUri: consent.redirectUri };

describe('fake social provider codes (M1.2f)', () => {
  it('a signed code opens to the profile (email lowercased)', () => {
    const code = signFakeCode(SECRET, consent, 1_000);
    expect(openFakeCode(SECRET, code, expect1, 1_000)).toEqual({
      provider: 'google',
      subject: 'fake-google-123',
      email: 'tess@example.test',
      emailVerified: true,
      name: 'Tess',
    });
  });

  it('refuses a tampered, foreign-secret, expired, wrong-nonce, wrong-redirect or wrong-provider code', () => {
    const code = signFakeCode(SECRET, consent, 1_000);
    const [body, sig] = code.split('.');
    const forged = `${Buffer.from(
      JSON.stringify({ ...consent, email: 'victim@example.test', exp: 10 ** 13 }),
    ).toString('base64url')}.${sig}`;
    expect(openFakeCode(SECRET, forged, expect1, 1_000)).toBeNull();
    expect(openFakeCode('b'.repeat(64), code, expect1, 1_000)).toBeNull();
    expect(openFakeCode(SECRET, code, expect1, 1_000 + FAKE_CODE_TTL_MS)).toBeNull();
    expect(openFakeCode(SECRET, code, { ...expect1, nonce: 'other' }, 1_000)).toBeNull();
    expect(openFakeCode(SECRET, code, { ...expect1, redirectUri: 'https://evil.test/cb' }, 1_000)).toBeNull();
    expect(openFakeCode(SECRET, code, { ...expect1, provider: 'apple' }, 1_000)).toBeNull();
    expect(openFakeCode(SECRET, `${body}`, expect1, 1_000)).toBeNull();
    expect(openFakeCode(SECRET, 'x'.repeat(5000), expect1, 1_000)).toBeNull();
  });

  it('the fake adapter sends the browser to the consent page with state, nonce and redirect', async () => {
    const p = fakeSocialProvider('apple', {
      secret: SECRET,
      consentUrl: 'http://localhost:3000/auth/social/fake',
    });
    const url = new URL(
      await p.authorizationUrl({ state: 's1', codeVerifier: 'v', nonce: 'n1', redirectUri: 'http://x/cb' }),
    );
    expect(url.pathname).toBe('/auth/social/fake');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      provider: 'apple',
      state: 's1',
      nonce: 'n1',
      redirect_uri: 'http://x/cb',
    });
    expect(p.kind).toBe('fake');
  });

  it('fake subjects are stable per provider and email; relay emails are recognised', () => {
    expect(fakeSubject('google', 'A@x.test')).toBe(fakeSubject('google', 'a@x.test'));
    expect(fakeSubject('google', 'a@x.test')).not.toBe(fakeSubject('apple', 'a@x.test'));
    expect(isPrivateRelayEmail(fakeRelayEmail())).toBe(true);
    expect(isPrivateRelayEmail('abc@PrivateRelay.AppleID.com')).toBe(true);
    expect(isPrivateRelayEmail('abc@privaterelay.appleid.com.evil.test')).toBe(false);
    expect(isPrivateRelayEmail('abc@example.test')).toBe(false);
    expect(isPrivateRelayEmail(null)).toBe(false);
    expect(isSocialProvider('google')).toBe(true);
    expect(isSocialProvider('github')).toBe(false);
  });
});

describe('trusted device cookies (M1.2f)', () => {
  it('parses only `<uuid>.<43 base64url>` and names the cookie per scheme', () => {
    const id = '0192f000-0000-7000-8000-000000000000';
    const secret = 'A'.repeat(43);
    expect(parseTrustedDeviceCookie(`${id}.${secret}`)).toEqual({ id, secret });
    expect(parseTrustedDeviceCookie(`${id}.short`)).toBeNull();
    expect(parseTrustedDeviceCookie(`not-a-uuid.${secret}`)).toBeNull();
    expect(parseTrustedDeviceCookie('')).toBeNull();
    expect(parseTrustedDeviceCookie(null)).toBeNull();
    expect(trustedDeviceCookie(true)).toBe('__Host-yy.trusted');
    expect(trustedDeviceCookie(false)).toBe('yy.trusted');
  });

  it('labels devices from the user agent without keeping it', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
    expect(
      deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1'),
    ).toBe('Safari on iOS');
    expect(
      deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    ).toBe('Firefox on Windows');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0')).toBe(
      'Edge on Windows',
    );
    expect(deviceLabel('')).toBe('Unknown device');
    expect(deviceLabel(null)).toBe('Unknown device');
  });
});

describe('refresh tokens (M1.2f)', () => {
  it('are yyr_ + 256 random bits, stored as SHA-256 only', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a).not.toBe(b);
    expect(isRefreshToken(a)).toBe(true);
    expect(a).toMatch(/^yyr_[A-Za-z0-9_-]{43}$/);
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(a)).not.toContain(a.slice(4));
    expect(isRefreshToken('yyr_short')).toBe(false);
    expect(isRefreshToken(`xyz_${'a'.repeat(43)}`)).toBe(false);
  });
});
