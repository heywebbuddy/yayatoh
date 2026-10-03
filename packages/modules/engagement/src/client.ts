// Browser-safe pieces of the engagement module (no node:*, no database): DTO types, pure poll
// and Q&A rules for the live screens.

// M5.7b: the engagement kinds and the score formula (pure).
export { ENGAGEMENT_KINDS, type EngagementKind } from './domain/kinds.ts';
export {
  normalizeWord,
  percent,
  WORD_MAX_LENGTH,
  wordWeight,
} from './domain/polls.ts';
export { NAME_MAX_LENGTH, publicOrder, QUESTION_MAX_LENGTH } from './domain/questions.ts';
export { DEFAULT_WEIGHTS, engagementScore, MAX_WEIGHT, type Weights } from './domain/score.ts';
export type {
  ModPollDto,
  ModQuestionDto,
  ModStateDto,
  ParticipantStateDto,
  PollResultsDto,
  PublicLiveStateDto,
  PublicPollDto,
  PublicQuestionDto,
  StageDto,
} from './dto.ts';
export type { PollKind } from './schema.ts';
