export {
  campaignsOfEventTx,
  createCampaignCommand,
  createLevelCommand,
  deleteLevelCommand,
  donationsConsoleQuery,
  updateCampaignCommand,
} from './campaigns.ts';
// M4.8b: charity profile (staff-verified against the IRS list), fair-market values, receipts and
// year-end statements. Receipt wording: `src/legal/receipt-copy.ts` (legal-copy, for counsel).
export {
  CharityForReviewDto,
  CharityProfileDto,
  CharityProfileInput,
  charitiesForReviewTx,
  charityProfileQuery,
  IrsRecordInput,
  rejectCharityCommand,
  saveCharityProfileCommand,
  verifyCharityCommand,
} from './charity.ts';
// M6.5d: online giving per day and currency (accounting summaries).
export { type DonationDayTotals, donationDailyTotalsTx } from './daily-totals.ts';
// M6.1c: data-subject requests (export and erasure) for gifts, receipts and statements.
export { donationsDataSubjects } from './data-subject.ts';
// M4.8e: cards on file and pledge collection.
export {
  ATTEMPT_KINDS,
  CARD_SOURCES,
  CARD_STATUSES,
  COLLECTION_STATUSES,
  OFFLINE_METHODS,
  UNPAID_ALERT_DAYS,
} from './domain/collection.ts';
// M4.8d live giving screen: the thermometer for the room's projectors (signed link, realtime
// channel, reconnect snapshot), QR-to-give, names only for donors who opted in (P4-13).
export {
  CAMPAIGN_STATUSES,
  type CampaignStatus,
  DEFAULT_MAX_GIFT_MINOR,
  DEFAULT_MIN_GIFT_MINOR,
  DEFAULT_PROCESSING_FEE,
  DISPLAY_AS,
  type DisplayAs,
  GIFT_SOURCES,
  GIFT_STATUSES,
  type GiftSource,
  type GiftStatus,
  giftAmountProblem,
  type ProcessingFeeRule,
  processingFeeCover,
  shownName,
  TRIBUTE_KINDS,
  type TributeKind,
} from './domain/giving.ts';
// M4.8f matching gifts: challenge matches (sponsor, window, ratio, cap) computed from confirmed
// gifts, the sponsor's pledge, refunds of gifts, and the employer matching list (P4-17).
export {
  inWindow,
  MATCH_CAP_MAX_MINOR,
  MATCH_CAP_MIN_MINOR,
  MATCH_RATIOS,
  MATCH_STATUSES,
  type MatchPhase,
  type MatchStatus,
  matchableAmount,
  matchedAmount,
  matchPhase,
  remainingToCap,
} from './domain/matches.ts';
// M4.8c paddle raise: paddles, the console, spotters' entries and the recorder's pledges.
export {
  BULK_SCOPES,
  CALL_STATUSES,
  DEFAULT_PADDLE_START,
  ENTRY_REFUSALS,
  ENTRY_STATUSES,
  type EntryOutcome,
  type EntryRefusal,
  type EntryStatus,
  MAX_SYNC_BATCH,
  PADDLE_MAX,
  PADDLE_MIN,
  PLEDGE_SOURCES,
  parsePaddleNumber,
} from './domain/paddles.ts';
export {
  CHARITY_STATUSES,
  type CharityStatus,
  deductibleMinor,
  EXEMPT_KINDS,
  type ExemptKind,
  FMV_MAX_MINOR,
  formatReceiptNumber,
  giftReceiptAmounts,
  isDeductibleReceipt,
  normalizeEin,
  QUID_PRO_QUO_THRESHOLD_MINOR,
  quidProQuoNotice,
  RECEIPT_KINDS,
  statementTotals,
  statementYearDue,
  taxYearOf,
  ticketReceiptAmounts,
} from './domain/receipts.ts';
export {
  givingQrQuery,
  QR_PLACES,
  type QrPlace,
  SCREEN_THANKS_MAX,
  screenName,
  thermometer,
} from './domain/screen.ts';
export {
  CampaignDto,
  DonationsConsoleDto,
  GiftReceiptDto,
  HostGiftDto,
  LevelDto,
  PublicCampaignDto,
  PublicGivingDto,
  StartGiftInput,
  StartGiftResultDto,
} from './dto.ts';
export { EmployerExportParams, employerExportAction, employerExportBulk } from './employer-export.ts';
export {
  bulkFileExemptOrgLookup,
  type ExemptOrgLookup,
  type ExemptOrgRecord,
  exemptOrgLookupFromEnv,
  exemptProblem,
  parseEoBmf,
  recordedExemptOrgLookup,
} from './exempt-orgs/lookup.ts';
export { GiftExportParams, giftsExportAction, giftsExportBulk } from './export.ts';
export {
  clearFairValueCommand,
  type PublicTaxNotice,
  publicTaxNotices,
  setFairValueCommand,
} from './fair-value.ts';
export {
  catchUpGifts,
  giftOutcomesSubscriber,
  giftPaymentInput,
  giftReceipt,
  giftToken,
  publicGiving,
  startGiftCommand,
} from './gifts.ts';
export { CARD_CONSENT_VERSION } from './legal/card-consent.ts';
export { RECEIPT_COPY, RECEIPT_COPY_VERSION, type ReceiptCopy } from './legal/receipt-copy.ts';
export { activeMatchesTx, LiveMatchDto, resyncMatchPledgesTx } from './match-progress.ts';
export {
  cancelMatchCommand,
  catchUpGiftRefunds,
  closeMatchCommand,
  createMatchCommand,
  giftRefundsSubscriber,
  MatchDto,
  MatchesViewDto,
  MatchInput,
  matchesQuery,
  publicMatches,
} from './matches.ts';
export {
  AssignPaddleInput,
  BulkAssignInput,
  type CallDto,
  ConsoleLiveDto,
  EntryOutcomeDto,
  PADDLE_CONSOLE_CHANNEL,
  PADDLE_REALTIME_CHANNELS,
  type PaddleConsoleDto,
  type PaddleDto,
  type PaddleReviewDto,
  type PaddlesViewDto,
  type RaiseTotalsDto,
  RecordPaddlesInput,
  RecordPaddlesOutput,
  type ReviewEntryDto,
  SPOTTER_CHANNEL,
  SpotterStateDto,
} from './paddle-dto.ts';
export { consoleLiveTx, spotterStateTx } from './paddle-live.ts';
export {
  armLevelCommand,
  closeCallCommand,
  confirmEntriesCommand,
  paddleConsoleQuery,
  paddleReviewQuery,
  recordPaddlesCommand,
  spotterStateQuery,
  undoPaddleStepCommand,
  voidEntryCommand,
} from './paddle-raise.ts';
export {
  assignPaddleCommand,
  bulkAssignPaddlesCommand,
  paddleEventTx,
  paddlesQuery,
  releasePaddleCommand,
} from './paddles.ts';
export {
  applyCardChargeToOrder,
  ClaimedChargeDto,
  type CollectRunResult,
  claimPledgeChargesCommand,
  closePledgesCommand,
  collectPledges,
  PledgeCollectionDto,
  PledgePayResult,
  PledgeRowDto,
  PublicPledgeDto,
  pledgeCollectionQuery,
  pledgeMailer,
  pledgeOutcomesSubscriber,
  pledgePaymentInput,
  pledgePayToken,
  pledgePayUrl,
  publicPledge,
  recordPledgePaymentCommand,
  settleCardChargeCommand,
  startPledgePaymentCommand,
  unpaidPledgeEventIdsTx,
  unpaidPledgeFactsTx,
  writeOffPledgeCommand,
} from './pledge-collection.ts';
export { privateColumns } from './private-columns.ts';
export {
  type ReceiptDocInput,
  receiptEmailBody,
  receiptHtml,
  receiptText,
  type StatementDocInput,
  statementEmailBody,
  statementHtml,
  taxNoticeText,
} from './receipt-document.ts';
export {
  catchUpReceipts,
  FairValueRowDto,
  HostReceiptDto,
  issueReceiptTx,
  ReceiptDocumentDto,
  ReceiptsConsoleDto,
  receiptByToken,
  receiptDocumentQuery,
  receiptIssuer,
  receiptsConsoleQuery,
  receiptsOfOrdersTx,
  receiptToken,
  receiptUrl,
  StatementDocumentDto,
  statementByToken,
  statementMailer,
  statementsOfYearTx,
  statementToken,
  statementUrl,
  yearEndStatementsCommand,
} from './receipts.ts';
export { giftRetentionCommand, LAPSED_GIFT_DAYS, redactLapsedGiftsTx } from './retention.ts';
export {
  applyCardSetupCommand,
  attachCardSetupCommand,
  CardChargeDto,
  CardSetupDto,
  expireSavedCardsCommand,
  GiveWithCardResult,
  giveWithSavedCardCommand,
  partyCardTarget,
  removeSavedCardCommand,
  SavedCardViewDto,
  StartCardSetupInput,
  savedCardIdFromToken,
  savedCardToken,
  savedCardView,
  startCardSetupCommand,
} from './saved-cards.ts';
export {
  displayScreen,
  type PublicScreen,
  publicScreen,
  rotateScreenLinkCommand,
  saveScreenCommand,
  screenSettingsQuery,
  screenSnapshotTx,
} from './screen.ts';
export {
  EMPTY_SCREEN,
  GIVING_SCREEN_CHANNEL,
  SaveScreenInput,
  ScreenSettingsDto,
  ScreenStateDto,
} from './screen-dto.ts';
export { type ScreenClaim, signScreenToken, verifyScreenToken } from './screen-link.ts';
