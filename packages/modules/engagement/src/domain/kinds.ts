/**
 * M5.7b: what counts toward engagement. `check_in`: admitted at the event's door; `poll_vote`: a
 * ballot in a live poll; `question`: a question asked in a live session's Q&A; `feedback`: an
 * answered survey (session feedback or post-event); `enrollment`: a place taken in an optional
 * session.
 */
export const ENGAGEMENT_KINDS = ['check_in', 'poll_vote', 'question', 'feedback', 'enrollment'] as const;
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];
