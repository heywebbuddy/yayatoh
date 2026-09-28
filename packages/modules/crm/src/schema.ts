import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const crmSchema = pgSchema('crm');

export const CONTACT_SOURCES = ['checkout', 'ticket', 'import', 'manual', 'legacy'] as const;
export const CONSENT_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
/**
 * `marketing`: promotional messages (express written consent for texts). `informational`:
 * reminders and event updates by text (M3.5a); marketing consent also covers them.
 */
export const CONSENT_PURPOSES = ['marketing', 'informational'] as const;
export const CONSENT_STATUSES = ['granted', 'withdrawn', 'unknown_legacy'] as const;

/** Org-scoped people (roadmap §4.1): there is never a global attendee record. */
export const contacts = tenantTable(
  crmSchema,
  'contacts',
  {
    email: text('email').notNull(),
    emailNorm: text('email_norm').notNull(),
    name: text('name'),
    phoneE164: text('phone_e164'),
    userId: uuid('user_id'),
    mergedInto: uuid('merged_into'),
    source: text('source').notNull(),
  },
  (t) => [
    uniqueIndex('contacts_org_email_norm_key').on(t.orgId, t.emailNorm),
    check('contacts_email_norm_check', sql`email_norm = lower(btrim(email_norm)) and email_norm like '%@%'`),
    check('contacts_phone_check', sql`phone_e164 is null or phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('contacts_source_check', sql`source in ('checkout', 'ticket', 'import', 'manual', 'legacy')`),
  ],
);

/**
 * Consent ledger: append-only, the latest row per (contact, channel, purpose) wins. Every row
 * carries its evidence. Consent is never invented (roadmap §7.5): no row means no consent.
 */
export const consents = tenantTable(
  crmSchema,
  'consents',
  {
    contactId: uuid('contact_id').notNull(),
    channel: text('channel').notNull(),
    purpose: text('purpose').notNull(),
    status: text('status').notNull(),
    evidence: text('evidence').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('consents_org_contact_idx').on(t.orgId, t.contactId, t.channel, t.purpose, t.capturedAt),
    foreignKey({
      name: 'consents_contact_fk',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check('consents_channel_check', sql`channel in ('email', 'sms', 'whatsapp')`),
    check('consents_purpose_check', sql`purpose in ('marketing', 'informational')`),
    check('consents_status_check', sql`status in ('granted', 'withdrawn', 'unknown_legacy')`),
  ],
);
