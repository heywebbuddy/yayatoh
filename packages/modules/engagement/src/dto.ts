import { z } from 'zod';
import { ANONYMOUS_IDENTITY, POLL_KINDS, POLL_STATES, QUESTION_STATES } from './schema.ts';

/**
 * Allowlisted shapes (M5.7a). JSON-friendly (times as ISO strings) because the same shapes travel
 * on the realtime channels. Public shapes never carry a pending question, a participant key or a
 * name behind "Anonymous".
 */
const iso = z.iso.datetime({ offset: true });

export const PollKindDto = z.enum(POLL_KINDS);
export const PollOptionDto = z.object({ id: z.string().max(4), label: z.string().max(80) });
export const PollResultsDto = z.object({
  total: z.int().min(0),
  counts: z.array(z.object({ key: z.string().max(40), label: z.string().max(80), count: z.int().min(0) })),
  average: z.number().nullable(),
});
export type PollResultsDto = z.infer<typeof PollResultsDto>;

const PollBase = z.object({
  id: z.uuid(),
  kind: z.enum(POLL_KINDS),
  question: z.string(),
  options: z.array(PollOptionDto),
  maxChoices: z.int(),
  ratingScale: z.int().nullable(),
  showResults: z.boolean(),
  ballots: z.int().min(0),
  createdAt: iso,
});

/** A poll as the audience and the big screen see it: never a draft; results only when shown. */
export const PublicPollDto = PollBase.extend({
  state: z.enum(['open', 'closed']),
  results: PollResultsDto.nullable(),
});
export type PublicPollDto = z.infer<typeof PublicPollDto>;

/** A poll in the moderator console: any state, results always. */
export const ModPollDto = PollBase.extend({
  state: z.enum(POLL_STATES),
  results: PollResultsDto,
});
export type ModPollDto = z.infer<typeof ModPollDto>;

/** An approved question as the audience sees it. */
export const PublicQuestionDto = z.object({
  id: z.uuid(),
  body: z.string(),
  /** Null for an anonymous question. */
  authorName: z.string().nullable(),
  upvotes: z.int().min(0),
  answered: z.boolean(),
  createdAt: iso,
});
export type PublicQuestionDto = z.infer<typeof PublicQuestionDto>;

/** A question in the moderation queue (any state; the name behind "Anonymous" only by policy). */
export const ModQuestionDto = z.object({
  id: z.uuid(),
  body: z.string(),
  authorName: z.string().nullable(),
  anonymous: z.boolean(),
  state: z.enum(QUESTION_STATES),
  upvotes: z.int().min(0),
  answered: z.boolean(),
  createdAt: iso,
});
export type ModQuestionDto = z.infer<typeof ModQuestionDto>;

/** What is on stage, and whether questions are being taken. */
export const StageDto = z.object({
  livePollId: z.uuid().nullable(),
  pinnedQuestionId: z.uuid().nullable(),
  qaOpen: z.boolean(),
  allowAnonymous: z.boolean(),
  /** Whether moderators see the name behind an anonymous question (askers are told). */
  namesToModerators: z.boolean(),
});
export type StageDto = z.infer<typeof StageDto>;

/** Everything the audience and the big screen may see of one session, at once. */
export const PublicLiveStateDto = z.object({
  stage: StageDto,
  polls: z.array(PublicPollDto),
  questions: z.array(PublicQuestionDto),
});
export type PublicLiveStateDto = z.infer<typeof PublicLiveStateDto>;

export const SettingsDto = StageDto.extend({
  anonymousIdentity: z.enum(ANONYMOUS_IDENTITY),
  displayVersion: z.int().min(1),
});
export type SettingsDto = z.infer<typeof SettingsDto>;

/** The moderator console's state of one session. */
export const ModStateDto = z.object({
  stage: StageDto,
  polls: z.array(ModPollDto),
  questions: z.array(ModQuestionDto),
});
export type ModStateDto = z.infer<typeof ModStateDto>;

/** A session's engagement page in the console: off (no settings yet) or its full state. */
export const ModPageDto = z.object({
  enabled: z.boolean(),
  settings: SettingsDto.nullable(),
  state: ModStateDto.nullable(),
});
export type ModPageDto = z.infer<typeof ModPageDto>;

/** What one participant already did in a session (from their own key only). */
export const ParticipantStateDto = z.object({
  votedPollIds: z.array(z.uuid()),
  upvotedQuestionIds: z.array(z.uuid()),
  pendingQuestions: z.int().min(0),
});
export type ParticipantStateDto = z.infer<typeof ParticipantStateDto>;
