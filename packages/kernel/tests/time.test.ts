import { describe, expect, it } from 'vitest';
import { utcToZonedInput, zonedTimeToUtc, zoneOffsetMinutes } from '../src/index.ts';

describe('time rules', () => {
  it('knows zone offsets across DST', () => {
    expect(zoneOffsetMinutes(new Date('2027-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(zoneOffsetMinutes(new Date('2027-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
    expect(zoneOffsetMinutes(new Date('2027-07-15T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('converts wall-clock event times to UTC instants', () => {
    expect(zonedTimeToUtc('2027-10-14T09:00', 'America/Chicago').toISOString()).toBe(
      '2027-10-14T14:00:00.000Z',
    );
    expect(zonedTimeToUtc('2027-01-14T09:00', 'America/Chicago').toISOString()).toBe(
      '2027-01-14T15:00:00.000Z',
    );
    expect(zonedTimeToUtc('2027-06-12T16:00', 'Asia/Dubai').toISOString()).toBe('2027-06-12T12:00:00.000Z');
  });

  it('handles the spring-forward gap and the fall-back overlap', () => {
    // 02:30 does not exist on 2027-03-14 in New York; it resolves to 03:30 EDT (07:30Z).
    expect(zonedTimeToUtc('2027-03-14T02:30', 'America/New_York').toISOString()).toBe(
      '2027-03-14T07:30:00.000Z',
    );
    // 01:30 happens twice on 2027-11-07; the earlier (EDT) instant wins.
    expect(zonedTimeToUtc('2027-11-07T01:30', 'America/New_York').toISOString()).toBe(
      '2027-11-07T05:30:00.000Z',
    );
  });

  it('round-trips through the form representation', () => {
    const i = zonedTimeToUtc('2027-10-14T19:45', 'Europe/London');
    expect(utcToZonedInput(i, 'Europe/London')).toBe('2027-10-14T19:45');
  });
});
