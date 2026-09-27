import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  devPersonaTotpSecret,
  generateBackupCodes,
  generateTotpSecret,
  hotp,
  normalizeBackupCode,
  normalizeTotp,
  otpauthUri,
  secretKey,
  setupKey,
  totp,
  verifyTotp,
} from '../src/totp.ts';

// RFC 6238 appendix B (SHA-1 seed "12345678901234567890", 8 digits).
const RFC_KEY = new TextEncoder().encode('12345678901234567890');
const RFC_VECTORS: readonly [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    for (const [t, code] of RFC_VECTORS) expect(totp(RFC_KEY, t * 1000, 8)).toBe(code);
  });

  it('matches the RFC 4226 HOTP vectors for the first counters', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314'];
    expected.forEach((code, counter) => {
      expect(hotp(RFC_KEY, counter)).toBe(code);
    });
  });

  it('accepts the current code and one step either side, and nothing further', () => {
    const secret = generateTotpSecret();
    const key = secretKey(secret);
    const now = Date.UTC(2026, 8, 27, 12, 0, 15);
    expect(verifyTotp(secret, totp(key, now), now)).toBe(true);
    expect(verifyTotp(secret, totp(key, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(key, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(key, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, totp(key, now + 90_000), now)).toBe(false);
  });

  it('rejects malformed codes and another secret’s codes', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = totp(secretKey(secret), now);
    expect(verifyTotp(secret, `${code}0`, now)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false);
    expect(verifyTotp(secret, '', now)).toBe(false);
    expect(verifyTotp(generateTotpSecret(), code, now)).toBe(false);
    // Spaces are tolerated ("123 456").
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
    expect(normalizeTotp(' 12 34 56 ')).toBe('123456');
    expect(normalizeTotp('12345')).toBeNull();
  });
});

describe('setup key and otpauth URI', () => {
  it('round-trips base32 (RFC 4648 vectors)', () => {
    const enc = (s: string) => base32Encode(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('MY');
    expect(enc('fo')).toBe('MZXQ');
    expect(enc('foo')).toBe('MZXW6');
    expect(enc('foobar')).toBe('MZXW6YTBOI');
    expect(new TextDecoder().decode(base32Decode('mzxw 6ytb-oi=='))).toBe('foobar');
    expect(() => base32Decode('MZ1W')).toThrow();
  });

  it('shows a 32-character key in groups of four that decodes to the HMAC key', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Za-z0-9]{20}$/);
    const key = setupKey(secret);
    expect(key).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    expect(Buffer.from(base32Decode(key)).equals(Buffer.from(secretKey(secret)))).toBe(true);
  });

  it('builds an otpauth URI an authenticator app understands', () => {
    const uri = new URL(otpauthUri({ issuer: 'Yayatoh', account: 'pani@lakeside.test', secret: 'abc' }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Yayatoh:pani@lakeside.test');
    expect(uri.searchParams.get('secret')).toBe(base32Encode(secretKey('abc')));
    expect(uri.searchParams.get('issuer')).toBe('Yayatoh');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});

describe('backup codes', () => {
  it('issues ten distinct single-use codes in xxxxx-xxxxx form', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);
  });

  it('normalizes what people type back to the stored form', () => {
    expect(normalizeBackupCode(' abCD1 EFgh2 ')).toBe('abCD1-EFgh2');
    expect(normalizeBackupCode('abCD1-EFgh2')).toBe('abCD1-EFgh2');
    expect(normalizeBackupCode('abc')).toBeNull();
    expect(normalizeBackupCode('abCD1-EFgh2-x')).toBeNull();
  });
});

describe('development persona secret', () => {
  it('is deterministic per persona and dev password, and differs between personas', () => {
    const a = devPersonaTotpSecret('pani@lakeside.test', 'persona-dev-password');
    expect(a).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(devPersonaTotpSecret('pani@lakeside.test', 'persona-dev-password')).toBe(a);
    expect(devPersonaTotpSecret('maya@rosewood.test', 'persona-dev-password')).not.toBe(a);
    expect(devPersonaTotpSecret('pani@lakeside.test', 'another-password')).not.toBe(a);
  });
});
