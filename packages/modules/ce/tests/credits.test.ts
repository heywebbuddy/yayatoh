import { describe, expect, it } from 'vitest';
import {
  bucketsOf,
  CODE_PATTERN,
  type CreditRule,
  formatCredits,
  maskedName,
  newVerificationCode,
  normalizeCode,
  parseCredits,
  sessionCredit,
  totalCredits,
} from '../src/domain/credits.ts';

const at = (hm: string) => new Date(`2026-10-03T${hm}Z`);
const rule = (over: Partial<CreditRule> = {}): CreditRule => ({
  sessionId: 's1',
  startsAt: at('10:00:00'),
  endsAt: at('11:00:00'),
  minMinutes: 45,
  credits: 100,
  countInPerson: true,
  countVirtual: true,
  ...over,
});
const none = { visits: [], watchMinutes: [], zoom: [] };

describe('minute buckets', () => {
  it('counts every minute an interval overlaps, clipped to the session window', () => {
    expect(bucketsOf({ from: at('10:00:30'), to: at('10:45:10') }, rule()).size).toBe(46);
    expect(bucketsOf({ from: at('09:30:00'), to: at('10:05:00') }, rule()).size).toBe(5);
    expect(bucketsOf({ from: at('10:50:00'), to: at('12:00:00') }, rule()).size).toBe(10);
    // An open visit lasts until the session ends.
    expect(bucketsOf({ from: at('10:20:00'), to: null }, rule()).size).toBe(40);
    // Outside the window, or empty, counts nothing.
    expect(bucketsOf({ from: at('11:00:00'), to: at('11:30:00') }, rule()).size).toBe(0);
    expect(bucketsOf({ from: at('10:10:00'), to: at('10:10:00') }, rule()).size).toBe(0);
  });
});

describe('session credit', () => {
  it('qualifies from scans alone, watch time alone, or both together; a minute counts once', () => {
    const scans = { ...none, visits: [{ from: at('10:00:00'), to: at('10:30:00') }] };
    expect(sessionCredit(rule(), scans)).toMatchObject({
      inPersonMinutes: 30,
      minutes: 30,
      qualifies: false,
      credits: 0,
    });
    const watched = Array.from({ length: 20 }, (_, i) => new Date(at('10:25:00').getTime() + i * 60_000));
    const both = { ...scans, watchMinutes: watched };
    // 10:00–10:30 in person, 10:25–10:45 online: 45 distinct minutes (5 overlap once).
    expect(sessionCredit(rule(), both)).toEqual({
      sessionId: 's1',
      inPersonMinutes: 30,
      virtualMinutes: 20,
      minutes: 45,
      qualifies: true,
      credits: 100,
    });
    // In-person-only rule ignores the watch time; online-only ignores the scans.
    expect(sessionCredit(rule({ countVirtual: false }), both)).toMatchObject({
      minutes: 30,
      qualifies: false,
    });
    expect(sessionCredit(rule({ countInPerson: false, minMinutes: 20 }), both)).toMatchObject({
      minutes: 20,
      qualifies: true,
    });
  });

  it('merges Zoom segments with heartbeat minutes and ignores minutes outside the window', () => {
    const facts = {
      visits: [],
      watchMinutes: [at('09:59:00'), at('10:01:00'), at('11:00:00')],
      zoom: [
        { from: at('10:00:10'), to: at('10:20:00') },
        { from: at('10:19:30'), to: at('10:40:00') },
      ],
    };
    const r = sessionCredit(rule({ minMinutes: 40 }), facts);
    expect(r).toMatchObject({ virtualMinutes: 40, minutes: 40, qualifies: true });
  });

  it('never qualifies with no attendance, and totals hundredths', () => {
    expect(sessionCredit(rule({ minMinutes: 1 }), none).qualifies).toBe(false);
    expect(totalCredits([{ credits: 150 }, { credits: 25 }, { credits: 0 }])).toBe(175);
  });
});

describe('credit values', () => {
  it('parses and formats hundredths', () => {
    expect(parseCredits('1.5')).toBe(150);
    expect(parseCredits('1,25')).toBe(125);
    expect(parseCredits('2')).toBe(200);
    expect(parseCredits('0')).toBeNull();
    expect(parseCredits('1.555')).toBeNull();
    expect(parseCredits('101')).toBeNull();
    expect(parseCredits('abc')).toBeNull();
    expect(formatCredits(150, 'en')).toBe('1.5');
    expect(formatCredits(150, 'de')).toBe('1,5');
    expect(formatCredits(200, 'en')).toBe('2');
  });
});

describe('verification codes', () => {
  it('are 10 Crockford characters and normalize when typed loosely', () => {
    for (let i = 0; i < 50; i++) expect(newVerificationCode()).toMatch(CODE_PATTERN);
    expect(newVerificationCode(() => new Uint8Array(10))).toBe('00000-00000');
    expect(normalizeCode('abcde fghjk')).toBe('ABCDE-FGHJK');
    expect(normalizeCode('o1ili-00000')).toBe('01111-00000');
    expect(normalizeCode('ABCDE-FGHJ')).toBeNull();
    expect(normalizeCode('ABCDE-FGHJU')).toBeNull();
  });

  it('mask the holder name on the public page', () => {
    expect(maskedName('Ana Lovelace')).toBe('Ana L.');
    expect(maskedName('  Ben  ')).toBe('Ben');
    expect(maskedName('Ada King Lovelace')).toBe('Ada L.');
    expect(maskedName('')).toBe('—');
  });
});
