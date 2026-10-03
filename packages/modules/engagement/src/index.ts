// M5.7a: live polls and moderated Q&A per program session.

// M5.8b: networking chat (1:1 between connections and meeting parties, booth chat, moderation).
export {
  blockBoothCommand,
  boothThreadQuery,
  chatInboxQuery,
  chatReported,
  chatStarted,
  chatThreadQuery,
  markChatReadCommand,
  ReportChatInput,
  reportChatCommand,
  SendBoothInput,
  SendChatInput,
  sendBoothMessageCommand,
  sendChatMessageCommand,
} from './chat/attendee.ts';
export {
  chatConsoleQuery,
  moderateChatReportCommand,
  removeChatMessageCommand,
  restoreBoothChatCommand,
} from './chat/console.ts';
export * from './chat/dto.ts';
export {
  blockVisitorCommand,
  boothChatThreadQuery,
  boothInboxQuery,
  markBoothReadCommand,
  replyBoothChatCommand,
  reportVisitorCommand,
  setBoothChatCommand,
} from './chat/exhibitor.ts';
export { BOOTH_CHAT_CHANNEL, CHAT_CHANNEL, CHAT_REALTIME_CHANNELS } from './chat/realtime.ts';
export { chatReportsForReviewTx, chatRetentionCommand, reviewChatReportCommand } from './chat/review.ts';
export { attendeeChatChannel, chatAttachAllowed, exhibitorChatChannel } from './chat/stream.ts';
export {
  CreatePollInput,
  closePollCommand,
  createPollCommand,
  deletePollCommand,
  enableLiveCommand,
  liveSessionsQuery,
  MAX_POLLS_PER_SESSION,
  moderateQuestionCommand,
  moderationQuery,
  openPollCommand,
  pinQuestionCommand,
  presentPollCommand,
  rotateDisplayLinkCommand,
  setPollResultsCommand,
  UpdateSettingsInput,
  updateSettingsCommand,
} from './commands.ts';
// M6.1a contact merges (batch 3u merge): the engagement log and networking profiles move.
export { engagementContactOwner } from './contact-merge.ts';
// M6.1c: data-subject requests (questions signed with the person's full name; networking and
// chat, M5.8a/b, wired at the batch 3u merge).
export { engagementDataSubjects } from './data-subject.ts';
export {
  BOOTH_PER_MINUTE,
  CHAT_MESSAGE_MAX,
  CHAT_PAGE,
  CHAT_PER_HOUR,
  CHAT_PER_MINUTE,
  CHAT_RETENTION_MONTHS,
  type ChatRefusal,
  chatRefusal,
  chatRetentionCutoff,
  NEW_CHATS_PER_HOUR,
  normalizeChatBody,
  UNANSWERED_LIMIT,
} from './domain/chat.ts';
// M5.8a: networking (directory, connections, meetings, block and report).
export {
  DIRECTORY_PAGE,
  escapeLike,
  freeTable,
  INTEREST_MAX_LENGTH,
  icsEscape,
  MAX_INTERESTS,
  MAX_LOCATION_CAPACITY,
  MAX_PENDING_REQUESTS,
  MAX_SLOT_MINUTES,
  MAX_SLOT_SERIES,
  MIN_SLOT_MINUTES,
  meetingIcs,
  normalizeInterests,
  slotSeries,
} from './domain/networking.ts';
export {
  type BallotProblem,
  ballotKeys,
  MAX_OPTIONS,
  MAX_WORDS,
  MIN_OPTIONS,
  normalizeWord,
  type PollOption,
  type PollResults,
  percent,
  pollResults,
  WORD_MAX_LENGTH,
  WORDS_SHOWN,
  wordWeight,
} from './domain/polls.ts';
export {
  MAX_QUESTIONS_PER_SESSION,
  MODERATION_ACTIONS,
  type ModerationAction,
  moderate,
  NAME_MAX_LENGTH,
  publicOrder,
  QUESTION_MAX_LENGTH,
  QUESTION_RATE,
} from './domain/questions.ts';
// M5.7b: engagement events and scores.
export {
  type Counts,
  DEFAULT_WEIGHTS,
  engagementScore,
  MAX_WEIGHT,
  normalizeCounts,
  sessionScore,
  type Weights,
} from './domain/score.ts';
export {
  type DisplayClaim,
  PARTICIPANT_KEY,
  participantKey,
  signDisplayToken,
  verifyDisplayToken,
} from './domain/tokens.ts';
export * from './dto.ts';
export {
  blockedQuery,
  blockPersonCommand,
  cancelMeetingCommand,
  DirectoryInput,
  directoryQuery,
  myConnectionsQuery,
  myMeetingQuery,
  myMeetingsQuery,
  networkHomeQuery,
  OptInInput,
  optInCommand,
  optOutCommand,
  personQuery,
  ReportInput,
  RequestConnectionInput,
  RequestMeetingInput,
  reportPersonCommand,
  requestConnectionCommand,
  requestMeetingCommand,
  respondConnectionCommand,
  respondMeetingCommand,
  UpdateProfileInput,
  unblockPersonCommand,
  updateProfileCommand,
  withdrawConnectionCommand,
} from './networking/attendee.ts';
export {
  AddSlotsInput,
  addMeetingSlotsCommand,
  deleteMeetingLocationCommand,
  deleteMeetingSlotCommand,
  networkConsoleQuery,
  resolveReportCommand,
  restoreProfileCommand,
  SaveLocationInput,
  saveMeetingLocationCommand,
  UpdateNetworkSettingsInput,
  updateNetworkSettingsCommand,
} from './networking/console.ts';
export * from './networking/dto.ts';
// M6.12b: matchmaking (embeddings of listed profiles, suggestions within the event).
export {
  MATCH_BATCH,
  MAX_MATCHES,
  MatchDto,
  MatchesDto,
  MatchmakingStatusDto,
  matchmakingStatusQuery,
  PendingEmbeddingsDto,
  pendingEmbeddingsQuery,
  profileEmbeddingText,
  storeEmbeddingsCommand,
  suggestedMatchesQuery,
} from './networking/matchmaking.ts';
export { networkingEvent, networkingOpen } from './networking/public.ts';
export {
  AskInput,
  askQuestionCommand,
  displaySession,
  type LiveSessionView,
  liveSessionIds,
  moderationSnapshotTx,
  participantState,
  publicLiveSession,
  publicSnapshotTx,
  sessionChannelOpen,
  upvoteQuestionCommand,
  VoteInput,
  voteCommand,
} from './participate.ts';
export { privateColumns } from './private-columns.ts';
export { ENGAGEMENT_REALTIME_CHANNELS, LIVE_CHANNEL, MODERATION_CHANNEL } from './realtime.ts';
export {
  ANONYMOUS_IDENTITY,
  type AnonymousIdentity,
  CHAT_KINDS,
  CHAT_MODERATION_STATES,
  CHAT_REVIEW_STATES,
  type ChatKind,
  CONNECTION_STATES,
  type ConnectionState,
  ENGAGEMENT_KINDS,
  type EngagementKind,
  LOCATION_KINDS,
  type LocationKind,
  MEETING_STATES,
  type MeetingState,
  NETWORK_EMBEDDING_DIMENSIONS,
  POLL_KINDS,
  POLL_STATES,
  type PollKind,
  type PollState,
  QUESTION_STATES,
  type QuestionState,
  REPORT_REASONS,
  REPORT_STATES,
  type ReportReason,
  type ReportState,
} from './schema.ts';
export {
  Account,
  AttendeeScoreDto,
  applyEngagementEventTx,
  catchUpEngagement,
  ENGAGEMENT_SOURCE_EVENTS,
  type EngagementFact,
  EventScoresDto,
  engagementActivity,
  eventScoresQuery,
  forgetEngagementTx,
  recordEngagementTx,
  rescoreTx,
  resetScoreWeightsCommand,
  SCORES_SHOWN,
  SessionScoreDto,
  scoreWeightsQuery,
  setScoreWeightsCommand,
  WeightsDto,
  weightsTx,
} from './scores.ts';
