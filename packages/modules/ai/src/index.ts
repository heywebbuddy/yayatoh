// M6.12b: AI v2 — drafting with a tone and a brand kit, audience suggestions, matchmaking.
export {
  BrandKitDto,
  brandVoiceTx,
  deleteBrandKitCommand,
  listBrandKitsQuery,
  SaveBrandKitInput,
  saveBrandKitCommand,
} from './brand-kits.ts';
export {
  AgendaDraftResultDto,
  AgendaProposalDto,
  AUDIENCE_EVENTS,
  AudienceSuggestionResultDto,
  CampaignDraftResultDto,
  DraftAgendaInput,
  DraftCampaignInput,
  DraftPageInput,
  draftAgenda,
  draftCampaign,
  draftPage,
  eventFacts,
  PageDraftResultDto,
  SuggestAudienceInput,
  suggestAudience,
} from './compose.ts';
export {
  adjustCreditsCommand,
  CreditBalanceDto,
  CreditEntryDto,
  creditBalanceQuery,
  creditLedgerQuery,
  DRAFT_TIMEOUT_MS,
  DraftInput,
  DraftResultDto,
  debitDraftCreditCommand,
  draftEventCopy,
  refundDraftCreditCommand,
} from './credits.ts';
export {
  AGENDA_MAX_SESSIONS,
  AiOutputError,
  type AudienceEventRef,
  AudienceSuggestionDto,
  type BrandVoice,
  buildComposePrompt,
  CampaignDraftDto,
  type ComposeRequest,
  cleanAgendaDraft,
  cleanAudienceSuggestion,
  cleanCampaignDraft,
  cleanPageDraft,
  MAX_BRIEF_LENGTH,
  PageDraftDto,
  referencedEventIds,
} from './domain/compose.ts';
export {
  buildPrompt,
  cleanDraft,
  DESCRIPTION_MAX,
  type DraftFacts,
  DraftOutputError,
  type DraftRequest,
  dataBlock,
  FAQ_MAX_ITEMS,
  MAX_NOTES_LENGTH,
  TAGLINE_MAX,
} from './domain/drafts.ts';
export {
  EMBED_BATCH,
  EMBEDDING_DIMENSIONS,
  fakeEmbedding,
  normalize,
  validEmbedding,
} from './domain/embed.ts';
export {
  AI_PURPOSES,
  type AiPurpose,
  COMPOSE_TASKS,
  type ComposeTask,
  type CreditState,
  DRAFT_COST,
  DRAFT_KINDS,
  type DraftKind,
  debit,
  effectiveBalance,
  FREE_MONTHLY_CREDITS,
  type LedgerEntry,
  ledgerBalance,
  periodOf,
  refund,
  rollover,
} from './domain/ledger.ts';
export { TONES, type Tone } from './domain/tones.ts';
export {
  type AiDrafter,
  AiUnavailableError,
  anthropicDrafter,
  drafterFromEnv,
  failingDrafter,
  fakeDrafter,
} from './drafter.ts';
export { MAX_REFRESH_CALLS, RefreshMatchmakingDto, refreshMatchmaking } from './matchmaking.ts';
export { privateColumns } from './private-columns.ts';
export { AI_CALL_TIMEOUT_MS, chargedCall, contentCredits, eventCredits, messagingCredits } from './spend.ts';
