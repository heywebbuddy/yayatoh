import { describe, expect, it } from 'vitest';
import {
  lastEntryOf,
  REENTRY_MAX_HOURS,
  REENTRY_MIN_HOURS,
  reentryDue,
  validReentryHours,
} from '../src/domain/reentry.ts';

const T0 = new Date('2027-06-01T10:00:00Z');
const after = (hours: number, extraMs = 0) => new Date(T0.getTime() + hours * 3_600_000 + extraMs);

describe('re-entry window', () => {
  it('is off by default: a second scan the same day is never a re-entry', () => {
    expect(reentryDue(T0, after(30), null)).toBe(false);
  });

  it('keeps scans inside the window as duplicates and allows the first one at N hours', () => {
    expect(reentryDue(T0, after(0), 3)).toBe(false);
    expect(reentryDue(T0, after(3, -1), 3)).toBe(false);
    expect(reentryDue(T0, after(3), 3)).toBe(true);
    expect(reentryDue(T0, after(5), 3)).toBe(true);
  });

  it('measures from the last entry, not the first', () => {
    const second = { admittedAt: T0, lastEntryAt: after(4) };
    expect(lastEntryOf(second)).toEqual(after(4));
    expect(lastEntryOf({ admittedAt: T0, lastEntryAt: null })).toEqual(T0);
    expect(reentryDue(lastEntryOf(second), after(6), 3)).toBe(false);
    expect(reentryDue(lastEntryOf(second), after(7), 3)).toBe(true);
  });

  it('accepts 1 to 72 hours only', () => {
    expect([REENTRY_MIN_HOURS, REENTRY_MAX_HOURS]).toEqual([1, 72]);
    expect([0, 1, 72, 73, 1.5, -2].map(validReentryHours)).toEqual([false, true, true, false, false, false]);
    expect(reentryDue(T0, after(100), 0)).toBe(false);
    expect(reentryDue(T0, after(100), 73)).toBe(false);
  });
});
