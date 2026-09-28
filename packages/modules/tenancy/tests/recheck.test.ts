import { describe, expect, it } from 'vitest';
import { providerBackoffMs, RECHECK_MAX_AGE_MS, recheckDue, recheckIntervalMs } from '../src/index.ts';

const MIN = 60_000;
const at = (ms: number) => new Date(Date.UTC(2027, 0, 1) + ms);

describe('pending domain re-check schedule (M1.3f)', () => {
  it('checks often at first and backs off with age', () => {
    expect(recheckIntervalMs(0)).toBe(MIN);
    expect(recheckIntervalMs(30 * MIN)).toBe(5 * MIN);
    expect(recheckIntervalMs(2 * 60 * MIN)).toBe(15 * MIN);
    expect(recheckIntervalMs(12 * 60 * MIN)).toBe(30 * MIN);
    expect(recheckIntervalMs(3 * 24 * 60 * MIN)).toBe(60 * MIN);
  });

  it('is due when never checked, or once the interval since the last check has passed', () => {
    const createdAt = at(0);
    expect(recheckDue({ createdAt, lastCheckedAt: null }, at(1000))).toBe(true);
    expect(recheckDue({ createdAt, lastCheckedAt: at(0) }, at(30_000))).toBe(false);
    expect(recheckDue({ createdAt, lastCheckedAt: at(0) }, at(MIN))).toBe(true);
    // Half an hour old: every five minutes.
    expect(recheckDue({ createdAt, lastCheckedAt: at(28 * MIN) }, at(30 * MIN))).toBe(false);
    expect(recheckDue({ createdAt, lastCheckedAt: at(25 * MIN) }, at(30 * MIN))).toBe(true);
  });

  it('stops after a week (and never checks a domain from the future)', () => {
    const createdAt = at(0);
    expect(recheckDue({ createdAt, lastCheckedAt: null }, at(RECHECK_MAX_AGE_MS + 1))).toBe(false);
    expect(recheckDue({ createdAt: at(MIN), lastCheckedAt: null }, at(0))).toBe(false);
  });

  it('backs the whole job off exponentially after provider failures, capped at 30 minutes', () => {
    expect(providerBackoffMs(0)).toBe(0);
    expect(providerBackoffMs(1)).toBe(MIN);
    expect(providerBackoffMs(2)).toBe(2 * MIN);
    expect(providerBackoffMs(3)).toBe(4 * MIN);
    expect(providerBackoffMs(10)).toBe(30 * MIN);
  });
});
