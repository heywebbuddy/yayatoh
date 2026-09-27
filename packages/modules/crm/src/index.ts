export {
  type ConsentInput,
  contactIdByEmailTx,
  currentConsentTx,
  normalizeEmail,
  recordConsentTx,
  type UpsertContact,
  upsertContactsTx,
  upsertContactTx,
} from './contacts.ts';
export { CONSENT_CHANNELS, CONSENT_PURPOSES, CONSENT_STATUSES, CONTACT_SOURCES } from './schema.ts';
