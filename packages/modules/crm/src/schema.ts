import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const crmSchema = pgSchema('crm');

export const CONTACT_SOURCES = ['checkout', 'ticket', 'import', 'manual', 'legacy'] as const;
export const CONSENT_CHANNELS = ['email', 'sms'] as const;
export const CONSENT_PURPOSES = ['marketing'] as const;
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
    check('consents_channel_check', sql`channel in ('email', 'sms')`),
    check('consents_purpose_check', sql`purpose in ('marketing')`),
    check('consents_status_check', sql`status in ('granted', 'withdrawn', 'unknown_legacy')`),
  ],
);

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const PROJECTION_SOURCES = ['legacy', 'live'] as const;

/**
 * One row per contact × event (roadmap §5.1 `event_participation`): tickets held, their types,
 * whether they had a seat and checked in, when they registered and what they spent (`currency`
 * is the event's). M2.2c backfills legacy history (`source = 'legacy'`); the live projector is
 * M3.6. `(org_id, event_id)` references `events.events` through a hand-written migration, so this
 * module never imports the events schema.
 */
export const eventParticipation = tenantTable(
  crmSchema,
  'event_participation',
  {
    contactId: uuid('contact_id').notNull(),
    eventId: uuid('event_id').notNull(),
    ticketTypeIds: uuid('ticket_type_ids').array().notNull().default(sql`'{}'::uuid[]`),
    tickets: integer('tickets').notNull().default(0),
    hasSeat: boolean('has_seat').notNull().default(false),
    checkedIn: boolean('checked_in').notNull().default(false),
    registeredAt: tsz('registered_at').notNull(),
    spendMinor: bigint('spend_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    source: text('source').notNull(),
    /** M3.6: on the event's list (an active ticket held, or a guest). Buyers of others' tickets are not. */
    registered: boolean('registered').notNull().default(false),
    /** M3.6: paid orders this contact placed as the buyer for the event. */
    orders: integer('orders').notNull().default(0),
    /** M3.6: the union of the contact's attendee labels at the event (M1.8f). */
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex('event_participation_org_contact_event_key').on(t.orgId, t.contactId, t.eventId),
    index('event_participation_org_event_idx').on(t.orgId, t.eventId),
    foreignKey({
      name: 'event_participation_contact_fk',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check('event_participation_counts_check', sql`tickets >= 0 and spend_minor >= 0`),
    check('event_participation_orders_check', sql`orders >= 0`),
    check('event_participation_labels_check', sql`cardinality(labels) <= 60`),
    check('event_participation_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('event_participation_source_check', sql`source in ('legacy', 'live')`),
  ],
);

/**
 * Per-contact totals (roadmap §5.1 `contact_stats`, the part the migration can know): orders,
 * tickets, events registered and attended, lifetime spend per currency, first and last seen.
 * LTV/RFM scoring is M6.1.
 */
export const contactStats = tenantTable(
  crmSchema,
  'contact_stats',
  {
    contactId: uuid('contact_id').notNull(),
    currency: text('currency').notNull(),
    orders: integer('orders').notNull().default(0),
    tickets: integer('tickets').notNull().default(0),
    events: integer('events').notNull().default(0),
    eventsAttended: integer('events_attended').notNull().default(0),
    spendMinor: bigint('spend_minor', { mode: 'number' }).notNull().default(0),
    firstSeenAt: tsz('first_seen_at').notNull(),
    lastSeenAt: tsz('last_seen_at').notNull(),
    source: text('source').notNull(),
  },
  (t) => [
    uniqueIndex('contact_stats_org_contact_currency_key').on(t.orgId, t.contactId, t.currency),
    foreignKey({
      name: 'contact_stats_contact_fk',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check(
      'contact_stats_counts_check',
      sql`orders >= 0 and tickets >= 0 and events >= 0 and events_attended >= 0`,
    ),
    check('contact_stats_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('contact_stats_seen_check', sql`last_seen_at >= first_seen_at`),
    check('contact_stats_source_check', sql`source in ('legacy', 'live')`),
  ],
);

export const CONSENT_SUMMARIES = ['granted', 'withdrawn', 'unknown_legacy', 'none'] as const;

/**
 * M3.6 per-contact profile, projected from `event_participation` and the consent ledger (never
 * written by anything else): events registered and attended, tickets, paid orders, first and last
 * seen (registration times), labels, and the current marketing consent per channel (`none` = no
 * row, which means no consent). Spend stays per currency in `event_participation`.
 */
export const contactProfile = tenantTable(
  crmSchema,
  'contact_profile',
  {
    contactId: uuid('contact_id').notNull(),
    events: integer('events').notNull().default(0),
    eventsAttended: integer('events_attended').notNull().default(0),
    tickets: integer('tickets').notNull().default(0),
    orders: integer('orders').notNull().default(0),
    firstSeenAt: tsz('first_seen_at'),
    lastSeenAt: tsz('last_seen_at'),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
    emailConsent: text('email_consent').notNull().default('none'),
    smsConsent: text('sms_consent').notNull().default('none'),
  },
  (t) => [
    uniqueIndex('contact_profile_org_contact_key').on(t.orgId, t.contactId),
    index('contact_profile_org_last_seen_idx').on(t.orgId, t.lastSeenAt),
    foreignKey({
      name: 'contact_profile_contact_fk',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check(
      'contact_profile_counts_check',
      sql`events >= 0 and events_attended >= 0 and tickets >= 0 and orders >= 0`,
    ),
    check('contact_profile_seen_check', sql`last_seen_at is null or last_seen_at >= first_seen_at`),
    check('contact_profile_labels_check', sql`cardinality(labels) <= 200`),
    check(
      'contact_profile_consent_check',
      sql`email_consent in ('granted', 'withdrawn', 'unknown_legacy', 'none') and sms_consent in ('granted', 'withdrawn', 'unknown_legacy', 'none')`,
    ),
  ],
);
