import { describe, expect, it } from 'vitest';
import { givingQrQuery, SCREEN_THANKS_MAX, screenName, thermometer } from '../src/domain/screen.ts';
import { GIVING_SCREEN_CHANNEL, ScreenStateDto } from '../src/screen-dto.ts';
import { signScreenToken, verifyScreenToken } from '../src/screen-link.ts';

const ORG = '0190a0a0-0000-7000-8000-000000000001';
const EVENT = '0190a0a0-0000-7000-8000-000000000002';
const SECRET = 'screen-test-secret-0123456789abcdef0123';

describe('who the screen thanks by name (M4.8d, P4-13)', () => {
  const gift = (displayAs: 'full_name' | 'first_name' | 'anonymous', showOnScreen: boolean) =>
    screenName({ donorName: '  Ada   Lovelace ', displayAs, showOnScreen });

  it('names only donors who asked to be thanked on screen, as they chose to appear', () => {
    expect(gift('full_name', true)).toBe('Ada Lovelace');
    expect(gift('first_name', true)).toBe('Ada');
  });

  it('never names a donor who did not opt in, or an anonymous gift', () => {
    expect(gift('full_name', false)).toBeNull();
    expect(gift('first_name', false)).toBeNull();
    expect(gift('anonymous', true)).toBeNull();
    expect(gift('anonymous', false)).toBeNull();
  });
});

describe('the thermometer', () => {
  it('fills in whole percent and never shows 100 before the goal', () => {
    expect(thermometer(0, 10_000)).toEqual({ percent: 0, reached: false });
    expect(thermometer(2_500, 10_000)).toEqual({ percent: 25, reached: false });
    expect(thermometer(9_999, 10_000)).toEqual({ percent: 99, reached: false });
    expect(thermometer(10_000, 10_000)).toEqual({ percent: 100, reached: true });
    expect(thermometer(25_000, 10_000)).toEqual({ percent: 100, reached: true });
  });

  it('copes with nothing raised or no goal', () => {
    expect(thermometer(-5, 10_000)).toEqual({ percent: 0, reached: false });
    expect(thermometer(500, 0)).toEqual({ percent: 0, reached: false });
  });
});

describe('the signed screen link', () => {
  it('round-trips and carries the org, event and version', () => {
    const token = signScreenToken({ orgId: ORG, eventId: EVENT, version: 3 }, SECRET);
    expect(token).not.toContain('.');
    expect(verifyScreenToken(token, SECRET)).toEqual({ orgId: ORG, eventId: EVENT, version: 3 });
  });

  it('refuses a forged, edited or foreign token', () => {
    const token = signScreenToken({ orgId: ORG, eventId: EVENT, version: 1 }, SECRET);
    expect(verifyScreenToken(token, 'another-secret-0123456789abcdef01234567')).toBeNull();
    expect(verifyScreenToken(token.replace('~1~', '~2~'), SECRET)).toBeNull();
    const other = '0190a0a0-0000-7000-8000-000000000009';
    expect(verifyScreenToken(token.replace(EVENT, other), SECRET)).toBeNull();
    expect(verifyScreenToken(`${token}x`, SECRET)).toBeNull();
    expect(verifyScreenToken('not-a-token', SECRET)).toBeNull();
    expect(verifyScreenToken(`${ORG}~${EVENT}~0~abc`, SECRET)).toBeNull();
    expect(verifyScreenToken('a'.repeat(300), SECRET)).toBeNull();
  });
});

describe('what the screen may carry', () => {
  it('drops anything outside the allowlist (no emails, amounts per gift or holders)', () => {
    const parsed = ScreenStateDto.parse({
      campaign: { name: 'Fund-a-need', goalMinor: 100, currency: 'USD', id: 'x' },
      totalMinor: 50,
      gifts: 2,
      calling: null,
      thanks: ['Ada'],
      donors: [{ email: 'ada@example.test', amountMinor: 50 }],
    });
    expect(JSON.stringify(parsed)).not.toContain('ada@example.test');
    expect(Object.keys(parsed).sort()).toEqual(['calling', 'campaign', 'gifts', 'thanks', 'totalMinor']);
    expect(Object.keys(parsed.campaign ?? {}).sort()).toEqual(['currency', 'goalMinor', 'name']);
  });

  it('holds at most the newest names', () => {
    const names = Array.from({ length: SCREEN_THANKS_MAX + 1 }, (_, i) => `Donor ${i}`);
    expect(() =>
      ScreenStateDto.parse({ campaign: null, totalMinor: 0, gifts: 0, calling: null, thanks: names }),
    ).toThrow();
  });

  it('is an org-scoped event channel for members who read orders', () => {
    expect(GIVING_SCREEN_CHANNEL.key).toBe('event.giving-screen');
    expect(GIVING_SCREEN_CHANNEL.access).toEqual({ permission: 'orders:read' });
    expect(Object.keys(GIVING_SCREEN_CHANNEL.events).sort()).toEqual(['link', 'state']);
  });
});

describe('QR codes to the giving page', () => {
  it('name the campaign and where they were scanned', () => {
    expect(givingQrQuery(EVENT, 'screen')).toBe(`?c=${EVENT}&via=screen`);
    expect(givingQrQuery(EVENT, 'table')).toBe(`?c=${EVENT}&via=table`);
  });
});
