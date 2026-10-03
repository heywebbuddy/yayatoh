import { ENGAGEMENT_KINDS, type EngagementKind } from '../schema.ts';

/**
 * The engagement score (M5.7b), pure. For one attendee at one event:
 *
 *   score = Σ over kinds k of weight(k) × count(k)
 *
 * where `count(check_in)` is 1 when any of their tickets was admitted (0 otherwise; several
 * tickets or re-entries do not add up), and every other count is the number of distinct things
 * they did: polls voted in, questions asked, surveys answered, optional sessions enrolled in.
 * A session's score is the same sum over everything its attendees did in that session (votes,
 * questions, feedback and enrollments tied to it); its participants are the distinct people.
 * Weights are whole points from 0 to 100 per kind, set per org; scores are whole numbers.
 */
export type Weights = Readonly<Record<EngagementKind, number>>;
export type Counts = Readonly<Partial<Record<EngagementKind, number>>>;

export const MAX_WEIGHT = 100;

/** The defaults until an org sets its own: coming in counts most, a question more than a vote. */
export const DEFAULT_WEIGHTS: Weights = {
  check_in: 10,
  poll_vote: 2,
  question: 3,
  feedback: 5,
  enrollment: 1,
};

/** Counts as the formula reads them: check-in is 0 or 1, the rest as they are (never negative). */
export function normalizeCounts(counts: Counts): Record<EngagementKind, number> {
  const out = {} as Record<EngagementKind, number>;
  for (const k of ENGAGEMENT_KINDS) {
    const n = Math.max(0, Math.trunc(counts[k] ?? 0));
    out[k] = k === 'check_in' ? Math.min(n, 1) : n;
  }
  return out;
}

export function engagementScore(counts: Counts, weights: Weights = DEFAULT_WEIGHTS): number {
  const n = normalizeCounts(counts);
  let score = 0;
  for (const k of ENGAGEMENT_KINDS) score += weights[k] * n[k];
  return score;
}

/** A session's score: the weighted sum of what happened in it (no check-in cap: no door scans). */
export function sessionScore(counts: Counts, weights: Weights = DEFAULT_WEIGHTS): number {
  let score = 0;
  for (const k of ENGAGEMENT_KINDS) score += weights[k] * Math.max(0, Math.trunc(counts[k] ?? 0));
  return score;
}
