import { describe, expect, it } from 'vitest';
import {
  formatKioskCode,
  isKioskCodeShape,
  isKioskEmail,
  judgeKioskCode,
  KIOSK_CODE_ATTEMPTS,
  kioskBadgeStatus,
  kioskEmailOutcome,
  normalizeKioskCode,
} from '../src/client.ts';

describe('kiosk badge status (M5.5c)', () => {
  it('prints a never-printed badge with a template and nothing due', () => {
    expect(kioskBadgeStatus({ prints: 0, paymentDue: false, hasTemplate: true })).toBe('ready');
  });
  it('says printed once any print counted, before anything else', () => {
    expect(kioskBadgeStatus({ prints: 1, paymentDue: false, hasTemplate: true })).toBe('printed');
    expect(kioskBadgeStatus({ prints: 2, paymentDue: true, hasTemplate: false })).toBe('printed');
  });
  it('sends a balance due or a badge without a template to the desk', () => {
    expect(kioskBadgeStatus({ prints: 0, paymentDue: true, hasTemplate: true })).toBe('desk');
    expect(kioskBadgeStatus({ prints: 0, paymentDue: false, hasTemplate: false })).toBe('desk');
  });
});

describe('kiosk email outcome (M5.5c)', () => {
  it('one own ticket → that ticket', () => {
    expect(kioskEmailOutcome(1, false)).toBe('ticket');
  });
  it('several tickets or a waiting registration → the desk', () => {
    expect(kioskEmailOutcome(2, false)).toBe('desk');
    expect(kioskEmailOutcome(0, true)).toBe('desk');
  });
  it('nothing → none (no email, same answer)', () => {
    expect(kioskEmailOutcome(0, false)).toBe('none');
  });
});

describe('kiosk codes (M5.5c)', () => {
  it('formats six digits with leading zeros', () => {
    expect(formatKioskCode(42)).toBe('000042');
    expect(formatKioskCode(999_999)).toBe('999999');
    expect(formatKioskCode(1_000_000)).toBe('000000');
  });
  it('accepts six digits, spaces ignored', () => {
    expect(normalizeKioskCode(' 123 456 ')).toBe('123456');
    expect(isKioskCodeShape('123 456')).toBe(true);
    expect(isKioskCodeShape('12345')).toBe(false);
    expect(isKioskCodeShape('12345a')).toBe(false);
  });
  const now = new Date('2026-10-03T10:00:00Z');
  const live = { attempts: 0, expiresAt: new Date(now.getTime() + 60_000), usedAt: null };
  it('a right code is ok; a wrong one counts down', () => {
    expect(judgeKioskCode(live, true, now)).toEqual({ status: 'ok' });
    expect(judgeKioskCode(live, false, now)).toEqual({
      status: 'wrong',
      attemptsLeft: KIOSK_CODE_ATTEMPTS - 1,
    });
  });
  it('the fifth wrong try locks it, and a locked code refuses even the right one', () => {
    expect(judgeKioskCode({ ...live, attempts: KIOSK_CODE_ATTEMPTS - 1 }, false, now)).toEqual({
      status: 'locked',
    });
    expect(judgeKioskCode({ ...live, attempts: KIOSK_CODE_ATTEMPTS }, true, now)).toEqual({
      status: 'locked',
    });
  });
  it('expired or spent codes are expired', () => {
    expect(judgeKioskCode({ ...live, expiresAt: now }, true, now)).toEqual({ status: 'expired' });
    expect(judgeKioskCode({ ...live, usedAt: now }, true, now)).toEqual({ status: 'expired' });
  });
  it('checks an email shape loosely', () => {
    expect(isKioskEmail('amina@example.com')).toBe(true);
    expect(isKioskEmail(' amina@example.com ')).toBe(true);
    expect(isKioskEmail('amina@example')).toBe(false);
    expect(isKioskEmail('amina example.com')).toBe(false);
  });
});
