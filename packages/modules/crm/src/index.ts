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
export { privateColumns } from './private-columns.ts';
export {
  type ParticipationFacts,
  participantContactIdsTx,
  refreshContactProfilesTx,
  replaceParticipationTx,
} from './projection.ts';
export {
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  CONSENT_STATUSES,
  CONSENT_SUMMARIES,
  CONTACT_SOURCES,
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
  type ContactSyncRow,
  contactSyncRowTx,
  contactsChangedSinceTx,
  writeSyncedContactTx,
} from './sync.ts';
export {
  CONSENT_TERM_KEYS,
  CONSENT_TERMS,
  type ConsentTerm,
  currentTermVersion,
  isConsentTerm,
  recordTermConsentTx,
} from './terms.ts';
