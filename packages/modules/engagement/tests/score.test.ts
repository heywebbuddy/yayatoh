import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  engagementScore,
  MAX_WEIGHT,
  normalizeCounts,
  sessionScore,
} from '../src/domain/score.ts';
import { ENGAGEMENT_KINDS } from '../src/schema.ts';

describe('engagement score (M5.7b)', () => {
  it('is the weighted sum of the counts', () => {
    const counts = { check_in: 1, poll_vote: 3, question: 2, feedback: 1, enrollment: 4 };
    const w = { check_in: 8, poll_vote: 3, question: 4, feedback: 6, enrollment: 2 };
    expect(engagementScore(counts, w)).toBe(8 + 9 + 8 + 6 + 8);
  });

  it('reproduces the fixture attendee: one of everything but enrollment', () => {
    const w = { check_in: 8, poll_vote: 3, question: 4, feedback: 6, enrollment: 2 };
    expect(engagementScore({ check_in: 1, poll_vote: 1, question: 1, feedback: 1 }, w)).toBe(21);
  });

  it('counts a check-in once however many tickets or re-entries', () => {
    expect(engagementScore({ check_in: 3 })).toBe(DEFAULT_WEIGHTS.check_in);
    expect(normalizeCounts({ check_in: 5 }).check_in).toBe(1);
  });

  it('nothing done scores zero; missing, negative and fractional counts are not counted', () => {
    expect(engagementScore({})).toBe(0);
    expect(engagementScore({ poll_vote: -4, question: 1.9 })).toBe(DEFAULT_WEIGHTS.question);
  });

  it('a zero weight switches a kind off', () => {
    const w = { ...DEFAULT_WEIGHTS, poll_vote: 0 };
    expect(engagementScore({ poll_vote: 50, question: 1 }, w)).toBe(DEFAULT_WEIGHTS.question);
  });

  it('defaults cover every kind within the weight range', () => {
    for (const k of ENGAGEMENT_KINDS) {
      expect(Number.isInteger(DEFAULT_WEIGHTS[k])).toBe(true);
      expect(DEFAULT_WEIGHTS[k]).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_WEIGHTS[k]).toBeLessThanOrEqual(MAX_WEIGHT);
    }
  });

  it("a session's score adds what everyone did in it", () => {
    expect(sessionScore({ poll_vote: 10, question: 2, feedback: 3, enrollment: 20 })).toBe(
      10 * DEFAULT_WEIGHTS.poll_vote +
        2 * DEFAULT_WEIGHTS.question +
        3 * DEFAULT_WEIGHTS.feedback +
        20 * DEFAULT_WEIGHTS.enrollment,
    );
  });
});
