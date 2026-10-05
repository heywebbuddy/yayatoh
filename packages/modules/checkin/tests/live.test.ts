import { describe, expect, it } from 'vitest';
import { FEED_KINDS, feedKindOf, PRESENCE_PING_MS, PRESENCE_TTL_MS, presenceActive } from '../src/live.ts';

const NOW = new Date('2027-06-01T20:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('staff presence expiry (M3.3a)', () => {
  it('lasts two minutes after the last ping (four missed door-screen pings)', () => {
    expect(PRESENCE_TTL_MS).toBe(120_000);
    expect(PRESENCE_TTL_MS / PRESENCE_PING_MS).toBe(4);
    expect(presenceActive(NOW, NOW)).toBe(true);
    expect(presenceActive(ago(PRESENCE_TTL_MS), NOW)).toBe(true);
    expect(presenceActive(ago(PRESENCE_TTL_MS + 1), NOW)).toBe(false);
    expect(presenceActive(ago(3_600_000), NOW)).toBe(false);
  });

  it('tolerates a clock a little ahead, not a row from the far future', () => {
    expect(presenceActive(new Date(NOW.getTime() + 60_000), NOW)).toBe(true);
    expect(presenceActive(new Date(NOW.getTime() + 10 * 60_000), NOW)).toBe(false);
  });
});

describe('live feed kinds (M3.3a)', () => {
  it('sorts every scan result into check-in, re-entry, duplicate or refused', () => {
    expect(FEED_KINDS).toEqual(['checkin', 'reentry', 'duplicate', 'invalid', 'device']);
    expect(feedKindOf('admitted', false)).toBe('checkin');
    expect(feedKindOf('admitted', true)).toBe('reentry');
    expect(feedKindOf('granted', true)).toBe('checkin');
    expect(feedKindOf('provisional', false)).toBe('checkin');
    expect(feedKindOf('duplicate', false)).toBe('duplicate');
    expect(feedKindOf('duplicate_offline', false)).toBe('duplicate');
    for (const r of [
      'invalid',
      'void',
      'wrong_event',
      'not_today',
      'outside_window',
      'wrong_date',
      'superseded',
      'no_access',
      'wrong_checkpoint',
    ] as const)
      expect(feedKindOf(r, false)).toBe('invalid');
  });
});
