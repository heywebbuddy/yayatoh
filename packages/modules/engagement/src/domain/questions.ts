/**
 * Pure Q&A rules (M5.7a). Moderation moves a question between states; "answered" is a mark on an
 * approved question. The public sees approved questions only.
 */
import type { QuestionState } from '../schema.ts';

export const QUESTION_MAX_LENGTH = 300;
export const NAME_MAX_LENGTH = 60;
/** A participant may ask this many questions per session in the window (then `rate_limited`). */
export const QUESTION_RATE = { limit: 5, windowMs: 10 * 60_000 } as const;
/** Questions a session keeps (pending + approved + dismissed). */
export const MAX_QUESTIONS_PER_SESSION = 2_000;

export const MODERATION_ACTIONS = ['approve', 'dismiss', 'answer', 'unanswer'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export interface QuestionFacts {
  readonly state: QuestionState;
  readonly answered: boolean;
}

/** The question after a moderation action, or null when the action doesn't apply. */
export function moderate(q: QuestionFacts, action: ModerationAction): QuestionFacts | null {
  switch (action) {
    case 'approve':
      return q.state === 'approved' ? null : { state: 'approved', answered: false };
    case 'dismiss':
      return q.state === 'dismissed' ? null : { state: 'dismissed', answered: false };
    case 'answer':
      return q.state === 'approved' && !q.answered ? { state: 'approved', answered: true } : null;
    case 'unanswer':
      return q.state === 'approved' && q.answered ? { state: 'approved', answered: false } : null;
  }
}

/** The order the audience sees: unanswered before answered, most upvoted, then oldest first. */
export function publicOrder<T extends { upvotes: number; answered: boolean; createdAt: string; id: string }>(
  list: readonly T[],
  pinnedId: string | null = null,
): T[] {
  return [...list].sort(
    (a, b) =>
      Number(b.id === pinnedId) - Number(a.id === pinnedId) ||
      Number(a.answered) - Number(b.answered) ||
      b.upvotes - a.upvotes ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
      (a.id < b.id ? -1 : 1),
  );
}
