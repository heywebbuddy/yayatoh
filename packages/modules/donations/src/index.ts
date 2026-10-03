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
// M6.1c: data-subject requests (export and erasure) for gifts, receipts and statements.
export { donationsDataSubjects } from './data-subject.ts';
export {
  CAMPAIGN_STATUSES,
  type CampaignStatus,
  DEFAULT_MAX_GIFT_MINOR,
  DEFAULT_MIN_GIFT_MINOR,
  DEFAULT_PROCESSING_FEE,
  DISPLAY_AS,
  type DisplayAs,
  GIFT_STATUSES,
  type GiftStatus,
  giftAmountProblem,
  type ProcessingFeeRule,
  processingFeeCover,
  shownName,
  TRIBUTE_KINDS,
  type TributeKind,
} from './domain/giving.ts';
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
export { RECEIPT_COPY, RECEIPT_COPY_VERSION, type ReceiptCopy } from './legal/receipt-copy.ts';
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
