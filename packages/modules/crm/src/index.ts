export {
  type ConsentInput,
  contactIdByEmailTx,
  contactUserIdsTx,
  currentConsentTx,
  normalizeEmail,
  recordConsentTx,
  type UpsertContact,
  upsertContactsTx,
  upsertContactTx,
} from './contacts.ts';
export { contactDsarTx, eraseContactDsarTx } from './dsar.ts';
export { CONSENT_CHANNELS, CONSENT_PURPOSES, CONSENT_STATUSES, CONTACT_SOURCES } from './schema.ts';
