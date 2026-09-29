export {
  type ConsentInput,
  consentSummaryTx,
  contactByIdTx,
  contactIdByEmailTx,
  contactIdsByPhoneTx,
  contactPhonesTx,
  contactUserIdsTx,
  currentConsentTx,
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
