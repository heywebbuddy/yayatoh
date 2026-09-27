export {
  type ConsentInput,
  currentConsentTx,
  normalizeEmail,
  recordConsentTx,
  type UpsertContact,
  upsertContactTx,
} from './contacts.ts';
export { CONSENT_CHANNELS, CONSENT_PURPOSES, CONSENT_STATUSES, CONTACT_SOURCES } from './schema.ts';
