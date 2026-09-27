import { describe, expect, it } from 'vitest';
import { defaultPreference, isValidTimeZone, KINDS, quietHoursRelease } from '../src/index.ts';

describe('quietHoursRelease (recipient timezone)', () => {
  it('daytime is not quiet', () => {
    expect(quietHoursRelease(new Date('2030-06-10T15:00:00Z'), 'America/Chicago')).toBeNull(); // 10:00 CDT
    expect(quietHoursRelease(new Date('2030-06-11T01:59:00Z'), 'America/Chicago')).toBeNull(); // 20:59 CDT
  });
  it('late evening waits for 08:00 the next morning', () => {
    expect(quietHoursRelease(new Date('2030-06-11T02:00:00Z'), 'America/Chicago')?.toISOString()).toBe(
      '2030-06-11T13:00:00.000Z',
    );
  });
  it('early morning waits for 08:00 the same day', () => {
    expect(quietHoursRelease(new Date('2030-06-10T20:00:00Z'), 'Asia/Tokyo')?.toISOString()).toBe(
      '2030-06-10T23:00:00.000Z',
    ); // 05:00 → 08:00 JST
  });
  it('handles a DST change overnight (US spring forward)', () => {
    // 23:00 CST on 9 March 2030; DST starts 02:00 on 10 March, so 08:00 is CDT (UTC-5).
    expect(quietHoursRelease(new Date('2030-03-10T05:00:00Z'), 'America/Chicago')?.toISOString()).toBe(
      '2030-03-10T13:00:00.000Z',
    );
  });
  it('recognises valid zones', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});

describe('kinds registry', () => {
  it('only transactional kinds and member alerts are urgent', () => {
    for (const [kind, def] of Object.entries(KINDS)) {
      if (['reminders', 'event_updates', 'marketing'].includes(def.category))
        expect(def.urgent, kind).toBe(false);
    }
  });
  it('never defaults marketing on, never turns transactional off', () => {
    for (const ch of ['in_app', 'email', 'sms', 'push'] as const) {
      expect(defaultPreference('marketing', ch)).toBe(false);
      expect(defaultPreference('transactional', ch)).toBe(true);
    }
    expect(defaultPreference('sales', 'email')).toBe(false);
    expect(defaultPreference('messages', 'email')).toBe(true);
  });
});
