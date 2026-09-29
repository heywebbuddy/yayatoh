import { describe, expect, it } from 'vitest';
import {
  applicableStateRules,
  CAP_LIMITS,
  capVerdict,
  complaintRateBps,
  DEFAULT_CAPS,
  isGsm7,
  KINDS,
  nextAllowedInstant,
  quotaPeriod,
  STATE_RULES,
  shouldAutoPause,
  smsSegments,
  stateOfPhone,
  stateOfRegion,
  textConsentVerdict,
  whatsappCategoryOf,
  whatsappVerdict,
} from '../src/index.ts';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** When a text to these state rules may go out (null = now). */
const stateRelease = (now: string, input: { phone?: string; region?: string }) =>
  iso(
    nextAllowedInstant(
      new Date(now),
      applicableStateRules(input).flatMap(({ rule, zones }) =>
        zones.map((zone) => ({ zone, windows: rule.allowed })),
      ),
    ),
  );

describe('SMS segments (GSM-7 vs UCS-2, concatenation)', () => {
  it('counts an empty message as no segments', () => {
    expect(smsSegments('')).toMatchObject({ encoding: 'GSM-7', units: 0, segments: 0 });
  });
  it('fits 160 GSM-7 characters in one segment and 161 in two', () => {
    expect(smsSegments('a'.repeat(160))).toMatchObject({ encoding: 'GSM-7', segments: 1, remaining: 0 });
    expect(smsSegments('a'.repeat(161))).toMatchObject({ segments: 2, perSegment: 153, remaining: 145 });
    expect(smsSegments('a'.repeat(306)).segments).toBe(2);
    expect(smsSegments('a'.repeat(307)).segments).toBe(3);
  });
  it('counts extension characters as two septets and never splits them', () => {
    expect(smsSegments('€'.repeat(80))).toMatchObject({ encoding: 'GSM-7', units: 160, segments: 1 });
    expect(smsSegments('€'.repeat(81)).segments).toBe(2);
    // 152 septets then a two-septet "€": it moves whole to the second segment.
    expect(smsSegments(`${'a'.repeat(152)}€${'a'.repeat(10)}`)).toMatchObject({ units: 164, segments: 2 });
    expect(smsSegments(`${'a'.repeat(152)}€${'a'.repeat(151)}`).segments).toBe(2);
    expect(smsSegments(`${'a'.repeat(152)}€${'a'.repeat(152)}`).segments).toBe(3);
  });
  it('recognises the GSM alphabet, accents included', () => {
    expect(isGsm7('Doors open at 7! Café Ü ñ @ £ {x} ~ |')).toBe(true);
    expect(isGsm7('Ça va')).toBe(true);
    expect(isGsm7('ç')).toBe(false); // lower-case ç is not in the default alphabet
    expect(isGsm7('“smart quotes”')).toBe(false);
  });
  it('switches to UCS-2 for other scripts: 70 in one, 67 per segment', () => {
    expect(smsSegments('ا'.repeat(70))).toMatchObject({ encoding: 'UCS-2', segments: 1 });
    expect(smsSegments('ا'.repeat(71))).toMatchObject({ encoding: 'UCS-2', segments: 2, perSegment: 67 });
    expect(smsSegments('日本語'.repeat(45)).segments).toBe(3); // 135 units → 67 + 67 + 1
    // One non-GSM character makes the whole message UCS-2.
    expect(smsSegments(`${'a'.repeat(100)}ç`)).toMatchObject({ encoding: 'UCS-2', segments: 2 });
  });
  it('counts emoji as surrogate pairs and never splits them', () => {
    expect(smsSegments('🎉')).toMatchObject({ encoding: 'UCS-2', units: 2, segments: 1 });
    expect(smsSegments('🎉'.repeat(35)).segments).toBe(1); // 70 units
    expect(smsSegments('🎉'.repeat(36)).segments).toBe(2); // 72 units
    // 66 units then a pair: the pair moves to the next segment.
    expect(smsSegments(`${'ы'.repeat(66)}🎉${'ы'.repeat(66)}`)).toMatchObject({ units: 134, segments: 3 });
  });
});

describe('state quiet-hour rules (data)', () => {
  it('every rule is pending counsel and cites its statute', () => {
    for (const rule of Object.values(STATE_RULES)) {
      expect(rule.status).toBe('pending_tcpa_counsel');
      expect(rule.citation.length).toBeGreaterThan(5);
      expect(rule.source).toMatch(/^https?:\/\//);
    }
  });
  it('finds the state from an area code or an address', () => {
    expect(stateOfPhone('+15125550100')?.state).toBe('TX');
    expect(stateOfPhone('+19155550100')?.zones).toEqual(['America/Denver']); // El Paso
    expect(stateOfPhone('+18505550100')?.zones).toEqual(['America/New_York', 'America/Chicago']);
    expect(stateOfPhone('+13055550100')?.state).toBe('FL');
    expect(stateOfPhone('+14055550100')?.state).toBe('OK');
    expect(stateOfPhone('+12125550100')).toBeNull(); // New York: federal rules only
    expect(stateOfPhone('+445125550100')).toBeNull(); // not NANP
    expect(stateOfPhone('+15121550100')).toBeNull(); // invalid exchange
    expect(stateOfRegion('US-TX')).toBe('TX');
    expect(stateOfRegion('US-NY')).toBeNull();
    expect(stateOfRegion('TX')).toBeNull();
  });
  it('Texas: Sunday texts wait for noon; weekdays for 9 a.m.', () => {
    // Sunday 14 July 2030, 10:00 CDT → noon CDT.
    expect(stateRelease('2030-07-14T15:00:00Z', { phone: '+15125550100' })).toBe('2030-07-14T17:00:00.000Z');
    // Sunday 12:30 CDT: allowed.
    expect(stateRelease('2030-07-14T17:30:00Z', { phone: '+15125550100' })).toBeNull();
    // Monday 08:30 CDT → 09:00.
    expect(stateRelease('2030-07-15T13:30:00Z', { phone: '+15125550100' })).toBe('2030-07-15T14:00:00.000Z');
    // Saturday 21:30 CDT → Sunday noon (not Sunday 9 a.m.).
    expect(stateRelease('2030-07-14T02:30:00Z', { phone: '+15125550100' })).toBe('2030-07-14T17:00:00.000Z');
    // Address in Texas, number elsewhere: the address counts (both TX zones must allow).
    expect(stateRelease('2030-07-14T15:00:00Z', { phone: '+12125550100', region: 'US-TX' })).toBe(
      '2030-07-14T18:00:00.000Z', // noon MDT (El Paso) is later than noon CDT
    );
  });
  it('Texas Sunday across DST changes', () => {
    // Spring forward: Sunday 8 March 2026, 03:30 CDT (just after the gap) → noon CDT = 17:00Z.
    expect(stateRelease('2026-03-08T08:30:00Z', { phone: '+17135550100' })).toBe('2026-03-08T17:00:00.000Z');
    // Fall back: Sunday 1 November 2026, 01:30 (the repeated hour) → noon CST = 18:00Z.
    expect(stateRelease('2026-11-01T06:30:00Z', { phone: '+17135550100' })).toBe('2026-11-01T18:00:00.000Z');
    expect(stateRelease('2026-11-01T07:30:00Z', { phone: '+17135550100' })).toBe('2026-11-01T18:00:00.000Z');
  });
  it('Florida and Oklahoma stop at 8 p.m.', () => {
    // Florida 20:15 EDT → 08:00 the next morning.
    expect(stateRelease('2030-07-16T00:15:00Z', { phone: '+13055550100' })).toBe('2030-07-16T12:00:00.000Z');
    // Florida panhandle (850): must be allowed in Eastern and Central; 07:30 CDT = 08:30 EDT → 08:00 CDT.
    expect(stateRelease('2030-07-15T12:30:00Z', { phone: '+18505550100' })).toBe('2030-07-15T13:00:00.000Z');
    // Oklahoma 19:59 CDT allowed; 20:00 not.
    expect(stateRelease('2030-07-16T00:59:00Z', { phone: '+14055550100' })).toBeNull();
    expect(stateRelease('2030-07-16T01:00:00Z', { phone: '+14055550100' })).toBe('2030-07-16T13:00:00.000Z');
  });
  it('no state rule: no hold', () => {
    expect(stateRelease('2030-07-14T15:00:00Z', { phone: '+12125550100' })).toBeNull();
    expect(stateRelease('2030-07-14T15:00:00Z', {})).toBeNull();
  });
});

describe('frequency caps', () => {
  const now = new Date('2030-07-15T12:00:00Z');
  const ago = (h: number, category = 'event_updates') => ({
    category,
    sentAt: new Date(now.getTime() - h * 3_600_000),
  });
  it('under the cap: send', () => {
    expect(
      capVerdict({ category: 'event_updates', recent: [ago(1), ago(2)], caps: DEFAULT_CAPS, now }),
    ).toBeNull();
  });
  it('event updates over the cap wait until the oldest counted message leaves the window', () => {
    const v = capVerdict({
      category: 'event_updates',
      recent: [ago(1), ago(5), ago(20)],
      caps: DEFAULT_CAPS,
      now,
    });
    expect(v).toEqual({
      action: 'hold',
      reason: 'frequency_cap',
      until: new Date(now.getTime() + 4 * 3_600_000 + 1000),
    });
  });
  it('marketing over the cap is skipped, not deferred', () => {
    expect(
      capVerdict({
        category: 'marketing',
        recent: [ago(1, 'marketing'), ago(100, 'marketing')],
        caps: DEFAULT_CAPS,
        now,
      }),
    ).toEqual({ action: 'block', reason: 'frequency_cap' });
    // Outside its 7-day window: fine.
    expect(
      capVerdict({
        category: 'marketing',
        recent: [ago(1, 'marketing'), ago(200, 'marketing')],
        caps: DEFAULT_CAPS,
        now,
      }),
    ).toBeNull();
  });
  it('the org-wide cap counts every optional category', () => {
    const recent = [ago(1, 'reminders'), ago(2, 'reminders'), ago(3, 'marketing'), ago(4), ago(6)];
    const v = capVerdict({ category: 'reminders', recent, caps: DEFAULT_CAPS, now });
    expect(v?.action).toBe('hold');
    expect(v && 'until' in v ? v.until.toISOString() : null).toBe('2030-07-16T06:00:01.000Z'); // 6 h ago + 24 h
  });
  it('custom caps per org', () => {
    const caps = { ...DEFAULT_CAPS, event_updates: { maxMessages: 1, windowHours: 2 } };
    expect(capVerdict({ category: 'event_updates', recent: [ago(1)], caps, now })?.action).toBe('hold');
    expect(capVerdict({ category: 'event_updates', recent: [ago(3)], caps, now })).toBeNull();
    expect(CAP_LIMITS.maxMessages.min).toBeGreaterThanOrEqual(1);
  });
});

describe('complaint-rate auto-pause', () => {
  it('pauses strictly above 0.3 % with enough volume', () => {
    expect(shouldAutoPause(3, 1000)).toBe(false); // exactly 0.3 %
    expect(shouldAutoPause(4, 1000)).toBe(true); // 0.4 %
    expect(shouldAutoPause(1, 334)).toBe(false); // 0.299 %
    expect(shouldAutoPause(1, 333)).toBe(true); // 0.3003 %
    expect(shouldAutoPause(1, 99)).toBe(false); // too little volume
    expect(complaintRateBps(4, 1000)).toBe(40);
    expect(complaintRateBps(0, 0)).toBe(0);
  });
});

describe('quota periods (org calendar month)', () => {
  it('uses the org timezone and knows when it resets', () => {
    // 31 Jan 2030 23:30 in Chicago is already February in UTC.
    const p = quotaPeriod(new Date('2030-02-01T05:30:00Z'), 'America/Chicago');
    expect(p.period).toBe('2030-01');
    expect(p.resetsAt.toISOString()).toBe('2030-02-01T06:00:00.000Z');
    expect(quotaPeriod(new Date('2030-12-15T00:00:00Z'), 'UTC')).toEqual({
      period: '2030-12',
      resetsAt: new Date('2031-01-01T00:00:00Z'),
    });
  });
});

describe('consent and WhatsApp categories', () => {
  it('marketing texts need express written consent in the ledger', () => {
    expect(textConsentVerdict({ category: 'marketing', marketing: null, informational: null })).toEqual({
      action: 'block',
      reason: 'consent_missing',
    });
    expect(
      textConsentVerdict({ category: 'marketing', marketing: 'withdrawn', informational: 'granted' }),
    ).toEqual({
      action: 'block',
      reason: 'consent_withdrawn',
    });
    expect(
      textConsentVerdict({ category: 'marketing', marketing: 'unknown_legacy', informational: null })?.action,
    ).toBe('block');
    expect(
      textConsentVerdict({ category: 'marketing', marketing: 'granted', informational: null }),
    ).toBeNull();
  });
  it('reminders and updates need consent to informational texts (marketing consent covers them)', () => {
    expect(
      textConsentVerdict({ category: 'reminders', marketing: null, informational: 'granted' }),
    ).toBeNull();
    expect(
      textConsentVerdict({ category: 'event_updates', marketing: 'granted', informational: null }),
    ).toBeNull();
    expect(
      textConsentVerdict({ category: 'event_updates', marketing: 'granted', informational: 'withdrawn' }),
    ).toEqual({ action: 'block', reason: 'consent_withdrawn' });
    expect(textConsentVerdict({ category: 'event_updates', marketing: null, informational: null })).toEqual({
      action: 'block',
      reason: 'consent_missing',
    });
  });
  it('every kind has a WhatsApp category; US marketing WhatsApp is blocked (D16)', () => {
    for (const kind of Object.keys(KINDS))
      expect(['utility', 'marketing', 'authentication']).toContain(whatsappCategoryOf(kind));
    expect(whatsappCategoryOf('marketing.message')).toBe('marketing');
    expect(whatsappCategoryOf('messaging.announcement')).toBe('utility');
    expect(whatsappVerdict('marketing', '+15125550100')).toEqual({
      action: 'block',
      reason: 'whatsapp_marketing_us',
    });
    expect(whatsappVerdict('marketing', '+447700900123')).toBeNull();
    expect(whatsappVerdict('utility', '+15125550100')).toBeNull();
  });
});
