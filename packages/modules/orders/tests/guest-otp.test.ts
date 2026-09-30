import { describe, expect, it } from 'vitest';
import {
  type ChallengeState,
  checkGuestCode,
  checkGuestLink,
  GUEST_CODE_TTL_MS,
  GUEST_MAX_ATTEMPTS,
  GUEST_RESEND_COOLDOWN_MS,
  guestCodeHash,
  guestEmailHash,
  guestLinkToken,
  guestSecretHash,
  type LinkState,
  newGuestCode,
  newGuestSecret,
  parseGuestLinkToken,
  resendAt,
  sameDigest,
} from '../src/guest/otp.ts';

const SECRET = 'x'.repeat(64);
const ID = '01920000-0000-7000-8000-000000000001';
const NOW = new Date('2027-05-01T12:00:00Z');

const challenge = (code: string, over: Partial<ChallengeState> = {}): ChallengeState => ({
  id: ID,
  codeHash: guestCodeHash(SECRET, ID, code),
  attempts: 0,
  expiresAt: new Date(NOW.getTime() + GUEST_CODE_TTL_MS),
  usedAt: null,
  ...over,
});

describe('guest codes (M1.5f): generation and hashing', () => {
  it('are six digits, leading zeros kept, and spread across the range', () => {
    const codes = Array.from({ length: 2000 }, newGuestCode);
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    // Random, not derived: 2,000 draws from a million hardly ever collide much.
    expect(new Set(codes).size).toBeGreaterThan(1990);
    expect(codes.some((c) => c.startsWith('0') || Number(c) < 500_000)).toBe(true);
    expect(codes.some((c) => Number(c) >= 500_000)).toBe(true);
  });

  it('are stored only as an HMAC bound to the challenge id and the secret', () => {
    const h = guestCodeHash(SECRET, ID, '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
    expect(guestCodeHash(SECRET, ID, '123456')).toBe(h);
    expect(guestCodeHash(SECRET, '01920000-0000-7000-8000-000000000002', '123456')).not.toBe(h);
    expect(guestCodeHash('y'.repeat(64), ID, '123456')).not.toBe(h);
  });

  it('hash addresses case- and space-insensitively', () => {
    expect(guestEmailHash(SECRET, ' Ada@Example.TEST ')).toBe(guestEmailHash(SECRET, 'ada@example.test'));
    expect(guestEmailHash(SECRET, 'ada@example.test')).not.toBe(guestEmailHash(SECRET, 'bob@example.test'));
  });

  it('compares digests in constant time and never matches empty or different lengths', () => {
    const h = guestCodeHash(SECRET, ID, '000000');
    expect(sameDigest(h, h)).toBe(true);
    expect(sameDigest(h, guestCodeHash(SECRET, ID, '000001'))).toBe(false);
    expect(sameDigest(h, h.slice(0, 32))).toBe(false);
    expect(sameDigest('', '')).toBe(false);
    expect(sameDigest(null, h)).toBe(false);
  });
});

describe('guest codes: one attempt at a time', () => {
  it('the right code verifies', () => {
    expect(checkGuestCode(SECRET, challenge('482913'), '482913', NOW)).toEqual({ status: 'ok' });
  });

  it('a wrong code counts down the five tries, and the fifth locks it', () => {
    let row = challenge('482913');
    for (let i = 1; i < GUEST_MAX_ATTEMPTS; i++) {
      const r = checkGuestCode(SECRET, row, '000000', NOW);
      expect(r).toEqual({ status: 'wrong', attempts: i, attemptsLeft: GUEST_MAX_ATTEMPTS - i });
      row = { ...row, attempts: i };
    }
    expect(checkGuestCode(SECRET, row, '000000', NOW)).toEqual({ status: 'locked' });
  });

  it('a locked code stays locked even against the right code', () => {
    expect(checkGuestCode(SECRET, challenge('482913', { attempts: 5 }), '482913', NOW)).toEqual({
      status: 'locked',
    });
  });

  it('expires after ten minutes, exactly', () => {
    const row = challenge('482913');
    expect(
      checkGuestCode(SECRET, row, '482913', new Date(NOW.getTime() + GUEST_CODE_TTL_MS - 1)).status,
    ).toBe('ok');
    expect(checkGuestCode(SECRET, row, '482913', new Date(NOW.getTime() + GUEST_CODE_TTL_MS)).status).toBe(
      'expired',
    );
  });

  it('works once: a used code is used, whatever is typed', () => {
    const used = challenge('482913', { usedAt: NOW });
    expect(checkGuestCode(SECRET, used, '482913', NOW)).toEqual({ status: 'used' });
    expect(checkGuestCode(SECRET, used, '000000', NOW)).toEqual({ status: 'used' });
  });

  it('non-digit input is simply wrong (and still counts)', () => {
    expect(checkGuestCode(SECRET, challenge('482913'), '48291a', NOW).status).toBe('wrong');
    expect(checkGuestCode(SECRET, challenge('482913'), '4829133', NOW).status).toBe('wrong');
  });
});

describe('resend cooldown', () => {
  it('holds a new code back for 30 seconds after the last', () => {
    expect(GUEST_RESEND_COOLDOWN_MS).toBe(30_000);
    expect(resendAt(null, NOW)).toBeNull();
    expect(resendAt(NOW, new Date(NOW.getTime() + 10_000))?.getTime()).toBe(NOW.getTime() + 30_000);
    expect(resendAt(NOW, new Date(NOW.getTime() + 30_000))).toBeNull();
  });
});

describe('magic links: single use, 15 minutes, bound to the browser that asked', () => {
  const linkSecret = newGuestSecret();
  const browser = newGuestSecret();
  const row = (over: Partial<LinkState> = {}): LinkState => ({
    linkHash: guestSecretHash(SECRET, 'link', linkSecret),
    browserHash: guestSecretHash(SECRET, 'browser', browser),
    linkExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
    usedAt: null,
    attempts: 0,
    ...over,
  });

  it('tokens round-trip and reject anything malformed', () => {
    const token = guestLinkToken(ID, linkSecret);
    expect(parseGuestLinkToken(token)).toEqual({ challengeId: ID, secret: linkSecret });
    expect(token).not.toContain('.');
    expect(parseGuestLinkToken(`${ID}~short`)).toBeNull();
    expect(parseGuestLinkToken(`${ID}.${linkSecret}`)).toBeNull();
    expect(parseGuestLinkToken(`not-a-uuid~${linkSecret}`)).toBeNull();
    expect(parseGuestLinkToken(`${token}/extra`)).toBeNull();
  });

  it('opens in the browser that asked for it', () => {
    expect(checkGuestLink(SECRET, row(), linkSecret, browser, NOW)).toBe('ok');
  });

  it('opened in another browser (no state, or another state) asks for the code instead', () => {
    expect(checkGuestLink(SECRET, row(), linkSecret, null, NOW)).toBe('other_browser');
    expect(checkGuestLink(SECRET, row(), linkSecret, newGuestSecret(), NOW)).toBe('other_browser');
  });

  it('a forged, used, expired or locked link is invalid everywhere', () => {
    expect(checkGuestLink(SECRET, row(), newGuestSecret(), browser, NOW)).toBe('invalid');
    expect(checkGuestLink(SECRET, row({ usedAt: NOW }), linkSecret, browser, NOW)).toBe('invalid');
    expect(checkGuestLink(SECRET, row(), linkSecret, browser, new Date(NOW.getTime() + 15 * 60_000))).toBe(
      'invalid',
    );
    expect(checkGuestLink(SECRET, row({ attempts: 5 }), linkSecret, browser, NOW)).toBe('invalid');
    expect(
      checkGuestLink(SECRET, row({ linkHash: null, linkExpiresAt: null }), linkSecret, browser, NOW),
    ).toBe('invalid');
  });
});
