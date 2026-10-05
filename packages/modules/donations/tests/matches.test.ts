import { describe, expect, it } from 'vitest';
import {
  inWindow,
  matchableAmount,
  matchedAmount,
  matchPhase,
  remainingToCap,
  resyncedPledge,
} from '../src/domain/matches.ts';

const CAP = 2_500_000; // $25,000.00

describe('matchedAmount (M4.8f)', () => {
  it('a 1:1 match doubles every gift until the cap, and stops at the cap exactly', () => {
    expect(matchedAmount(0, 100, CAP)).toBe(0);
    expect(matchedAmount(10_000, 100, CAP)).toBe(10_000);
    expect(matchedAmount(2_499_999, 100, CAP)).toBe(2_499_999);
    expect(matchedAmount(2_500_000, 100, CAP)).toBe(CAP);
    expect(matchedAmount(2_500_001, 100, CAP)).toBe(CAP);
    expect(matchedAmount(9_000_000, 100, CAP)).toBe(CAP);
  });

  it('applies other ratios and rounds down to the minor unit', () => {
    expect(matchedAmount(10_000, 200, CAP)).toBe(20_000);
    expect(matchedAmount(10_001, 50, CAP)).toBe(5_000);
    expect(matchedAmount(333, 33, CAP)).toBe(109);
    expect(matchedAmount(2_000_000, 200, CAP)).toBe(CAP);
  });

  it('stays exact for very large sums', () => {
    expect(matchedAmount(Number.MAX_SAFE_INTEGER, 1_000, 1_000_000_000)).toBe(1_000_000_000);
    expect(matchedAmount(4_000_000_000_000, 300, 1_000_000_000)).toBe(1_000_000_000);
  });

  it('is zero for nothing, a zero ratio or a zero cap', () => {
    expect(matchedAmount(-5, 100, CAP)).toBe(0);
    expect(matchedAmount(100, 0, CAP)).toBe(0);
    expect(matchedAmount(100, 100, 0)).toBe(0);
  });
});

describe('remainingToCap', () => {
  it('says how much more giving unlocks the whole match', () => {
    expect(remainingToCap(0, 100, CAP)).toBe(CAP);
    expect(remainingToCap(1_000_000, 100, CAP)).toBe(1_500_000);
    expect(remainingToCap(3_000_000, 100, CAP)).toBe(0);
    expect(remainingToCap(0, 200, CAP)).toBe(1_250_000);
    // 2:3 of a 100 cap needs 150 (rounded up so the cap is really reached).
    expect(remainingToCap(0, 300, 100)).toBe(34);
    expect(matchedAmount(34, 300, 100)).toBe(100);
    expect(matchedAmount(33, 300, 100)).toBe(99);
  });
});

describe('matchableAmount', () => {
  it('counts a gift less what was refunded of it, the covered fee first', () => {
    const g = { amountMinor: 10_000, feeCoverMinor: 330 };
    expect(matchableAmount({ ...g, refundedMinor: 0 })).toBe(10_000);
    expect(matchableAmount({ ...g, refundedMinor: 330 })).toBe(10_000);
    expect(matchableAmount({ ...g, refundedMinor: 2_330 })).toBe(8_000);
    expect(matchableAmount({ ...g, refundedMinor: 10_330 })).toBe(0);
    expect(matchableAmount({ ...g, refundedMinor: 99_999 })).toBe(0);
    expect(matchableAmount({ amountMinor: 5_000, feeCoverMinor: 0, refundedMinor: 5_000 })).toBe(0);
  });
});

describe('windows and phases', () => {
  const w = { startsAt: new Date('2026-10-10T23:00:00Z'), endsAt: new Date('2026-10-11T01:00:00Z') };
  it('includes the start and excludes the end', () => {
    expect(inWindow(new Date('2026-10-10T22:59:59.999Z'), w)).toBe(false);
    expect(inWindow(w.startsAt, w)).toBe(true);
    expect(inWindow(new Date('2026-10-11T00:59:59Z'), w)).toBe(true);
    expect(inWindow(w.endsAt, w)).toBe(false);
  });
  it('is scheduled, live, then ended', () => {
    expect(matchPhase(new Date('2026-10-10T00:00:00Z'), w)).toBe('scheduled');
    expect(matchPhase(w.startsAt, w)).toBe('live');
    expect(matchPhase(w.endsAt, w)).toBe('ended');
  });
});

describe('resyncedPledge', () => {
  it('follows the match down, never up, and cancels at zero', () => {
    expect(resyncedPledge(CAP, CAP)).toBe(CAP);
    expect(resyncedPledge(CAP, 2_400_000)).toBe(2_400_000);
    expect(resyncedPledge(1_000, 5_000)).toBe(1_000);
    expect(resyncedPledge(1_000, 0)).toBeNull();
  });
});
