export {
  type ConsentInput,
  consentSummaryTx,
  contactByIdTx,
  contactIdByEmailTx,
  contactIdsByPhoneTx,
  contactIdsMatchingTx,
  contactPhonesTx,
  contactsByIdsTx,
  contactsForSendTx,
  contactUserIdsTx,
  currentConsentTx,
  type MarketingReach,
  marketingReachTx,
  normalizeEmail,
  recordConsentTx,
  setContactPhoneTx,
  type UpsertContact,
  upsertContactsTx,
  upsertContactTx,
} from './contacts.ts';
export { consentRegivenSinceTx, contactDsarTx, eraseContactDsarTx, unlinkContactUserTx } from './dsar.ts';
// M6.1a: duplicates, merge with undo, the person timeline.
export {
  BulkMergeDto,
  MergeChoicesInput,
  MergeResultDto,
  mergeContactsCommand,
  mergeDuplicatesBulkCommand,
  UndoMergeDto,
  undoMergeCommand,
} from './merge/commands.ts';
export * from './merge/domain.ts';
export { dismissDuplicateCommand, scanDuplicatesCommand, scanDuplicatesTx } from './merge/duplicates.ts';
export {
  type ContactSnapshot,
  type MergeInput,
  type MergeResult,
  mergeContactsTx,
  scrubMergeSnapshotsTx,
  undoMergeTx,
} from './merge/engine.ts';
export {
  type ContactReferenceOwner,
  contactColumnsTx,
  contactReferenceOwners,
  type MergeStep,
  type MovedRow,
  registerContactReferenceOwners,
  uncoveredContactColumnsTx,
} from './merge/owners.ts';
export {
  ContactCardDto,
  DuplicatePairDto,
  DuplicateQueueDto,
  duplicatePairQuery,
  duplicateQueueQuery,
  PeoplePageDto,
  PersonDto,
  peopleQuery,
  personQuery,
} from './merge/queries.ts';
export { privateColumns } from './private-columns.ts';
export {
  type ParticipationFacts,
  participantContactIdsTx,
  participationEventIdsTx,
  refreshContactProfilesTx,
  replaceParticipationTx,
} from './projection.ts';
// M6.1b contact stats.
export {
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  CONSENT_STATUSES,
  CONSENT_SUMMARIES,
  CONTACT_SIGNAL_KINDS,
  CONTACT_SOURCES,
  type ContactSignalKind,
  DUPLICATE_REASONS,
  DUPLICATE_STATUSES,
  MERGE_FIELDS,
  MERGE_STATUSES,
  TIMELINE_KINDS,
} from './schema.ts';
export {
  type CompileOptions,
  compileSegment,
  countSegmentTx,
  type ResolvedScopes,
  segmentContactIdsTx,
  segmentExportRowsTx,
  segmentPageTx,
} from './segments/compile.ts';
export * from './segments/dsl.ts';
export {
  type ComputedCurrencyStats,
  type ComputedScores,
  computeContactStats,
  type EventOver,
  type StatsParticipation,
  type StatsSignals,
} from './stats/compute.ts';
export * from './stats/formulas.ts';
export {
  NO_SIGNALS,
  recordContactSignalTx,
  signalTotalsTx,
  statsContactPageTx,
  statsParticipationTx,
  writeContactStatsTx,
} from './stats/projection.ts';
export {
  ContactStatsDto,
  ContactValueDto,
  contactStatsQuery,
  contactValueQuery,
  OrgContactStatsDto,
  OrgValueDto,
  orgContactStatsQuery,
  orgValueQuery,
} from './stats/queries.ts';
export { RFM_KEYS, type RfmKey } from './stats/rfm.ts';
export {
  CONSENT_TERM_KEYS,
  CONSENT_TERMS,
  type ConsentTerm,
  currentTermVersion,
  isConsentTerm,
  recordTermConsentTx,
} from './terms.ts';
export {
  activeContactIdsTx,
  recordTimelineTx,
  type TimelineCursor,
  type TimelineFact,
  type TimelineKind,
  type TimelineRow,
  timelineEventIdsTx,
  timelinePageTx,
} from './timeline.ts';
