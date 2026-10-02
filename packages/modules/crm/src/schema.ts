import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const crmSchema = pgSchema('crm');

/** `registration`: someone who submitted a registration form (M5.1b). */
export const CONTACT_SOURCES = ['checkout', 'ticket', 'import', 'manual', 'legacy', 'registration'] as const;
export const CONSENT_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
/**
 * `marketing`: promotional messages (express written consent for texts). `informational`:
 * reminders and event updates by text (M3.5a); marketing consent also covers them.
 * `exhibitor_sharing`: exhibitors who scan the person's badge may receive their email (P5-8,
 * asked at registration, M5.1b; used by lead retrieval, M5.6b). Never implies marketing.
 */
export const CONSENT_PURPOSES = ['marketing', 'informational', 'exhibitor_sharing'] as const;
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
    /** M6.1a: the person's company or organization (duplicate detection: fuzzy name + company). */
    company: text('company'),
  },
  (t) => [
    uniqueIndex('contacts_org_email_norm_key').on(t.orgId, t.emailNorm),
    // M6.1a duplicate detection: trigram match on names (served by crm.similar_contact_pairs).
    index('contacts_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('contacts_org_updated_idx').on(t.orgId, t.updatedAt),
    index('contacts_org_phone_idx').on(t.orgId, t.phoneE164).where(sql`phone_e164 is not null`),
    check('contacts_company_length', sql`company is null or length(company) between 1 and 200`),
    check('contacts_email_norm_check', sql`email_norm = lower(btrim(email_norm)) and email_norm like '%@%'`),
    check('contacts_phone_check', sql`phone_e164 is null or phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'`),
    check(
      'contacts_source_check',
      sql`source in ('checkout', 'ticket', 'import', 'manual', 'legacy', 'registration')`,
    ),
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
    /**
     * The version of the wording the person agreed to (`CONSENT_TERMS`, M5.1b). Null for consents
     * captured before terms were versioned (checkout checkbox, preference center, legacy).
     */
    version: integer('version'),
  },
  (t) => [
    index('consents_org_contact_idx').on(t.orgId, t.contactId, t.channel, t.purpose, t.capturedAt),
    foreignKey({
      name: 'consents_contact_fk',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check('consents_channel_check', sql`channel in ('email', 'sms', 'whatsapp')`),
    check('consents_purpose_check', sql`purpose in ('marketing', 'informational', 'exhibitor_sharing')`),
    check('consents_version_check', sql`version is null or version >= 1`),
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

// ---------------------------------------------------------------------------------------------
// M6.1a: duplicate detection, merge with undo, and the person timeline.

export const DUPLICATE_REASONS = ['email', 'phone', 'name_company'] as const;
export const DUPLICATE_STATUSES = ['open', 'dismissed', 'merged'] as const;
export const MERGE_STATUSES = ['applied', 'undone'] as const;
/** The fields a merge chooses one side for (field by field). */
export const MERGE_FIELDS = ['name', 'email', 'phone', 'company'] as const;
/**
 * Person timeline kinds (M6.1a). `session_attended`, `campaign_opened`, `campaign_clicked`,
 * `donation` and `rsvp` have no source yet (M5.2b, per-recipient tracking, M4.8a, M4.1d); the
 * vocabulary is fixed now so their owners only add a subscriber.
 */
export const TIMELINE_KINDS = [
  'order_paid',
  'order_refunded',
  'checked_in',
  'session_attended',
  'campaign_sent',
  'campaign_opened',
  'campaign_clicked',
  'message_in',
  'message_out',
  'donation',
  'rsvp',
  'survey_sent',
  'survey_responded',
] as const;

const inCheck = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * One merge of a duplicate (`source`) into the record that stays (`target`), M6.1a. The snapshot
 * holds both records' fields before the merge (an exact undo for 30 days); erasure scrubs it.
 * `summary` counts what each owning module moved (and kept on the source on a unique clash).
 */
export const contactMerges = tenantTable(
  crmSchema,
  'contact_merges',
  {
    sourceContactId: uuid('source_contact_id').notNull(),
    targetContactId: uuid('target_contact_id').notNull(),
    status: text('status').notNull().default('applied'),
    /** Which record each field came from: `{ name: 'source' | 'target', … }` (MERGE_FIELDS). */
    choices: jsonb('choices').notNull(),
    /** Both records before the merge (email, email_norm, name, phone, company, user). Null once erased. */
    snapshot: jsonb('snapshot'),
    /** Consent rows the merge appended to the target (removed again by an undo). */
    consentRowIds: uuid('consent_row_ids').array().notNull().default(sql`'{}'::uuid[]`),
    /** `{ moved: { table: n }, kept: { table: n } }`. */
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
    /** Merges started together (bulk merge) share one id. */
    bulkId: uuid('bulk_id'),
    mergedBy: text('merged_by').notNull(),
    mergedAt: tsz('merged_at').notNull(),
    undoUntil: tsz('undo_until').notNull(),
    undoneBy: text('undone_by'),
    undoneAt: tsz('undone_at'),
  },
  (t) => [
    index('contact_merges_org_target_idx').on(t.orgId, t.targetContactId, t.mergedAt),
    index('contact_merges_org_merged_idx').on(t.orgId, t.mergedAt),
    // A record is merged away at most once at a time.
    uniqueIndex('contact_merges_org_source_applied_key')
      .on(t.orgId, t.sourceContactId)
      .where(sql`status = 'applied'`),
    foreignKey({
      name: 'contact_merges_source_fk',
      columns: [t.orgId, t.sourceContactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'contact_merges_target_fk',
      columns: [t.orgId, t.targetContactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check('contact_merges_status_check', inCheck('status', MERGE_STATUSES)),
    check('contact_merges_distinct_check', sql`source_contact_id <> target_contact_id`),
    check('contact_merges_undone_check', sql`(status = 'undone') = (undone_at is not null)`),
    check('contact_merges_undo_window_check', sql`undo_until > merged_at`),
    check('contact_merges_actor_check', sql`length(merged_by) between 1 and 200`),
    check('contact_merges_undone_by_check', sql`undone_by is null or length(undone_by) between 1 and 200`),
  ],
);

/**
 * The rows each owning module moved in a merge (M6.1a), recorded through `recordMergeMovesTx`:
 * an undo moves exactly these back, and a replay never moves a row twice.
 */
export const contactMergeMoves = tenantTable(
  crmSchema,
  'contact_merge_moves',
  {
    mergeId: uuid('merge_id').notNull(),
    module: text('module').notNull(),
    refTable: text('ref_table').notNull(),
    rowId: uuid('row_id').notNull(),
  },
  (t) => [
    uniqueIndex('contact_merge_moves_org_merge_row_key').on(t.orgId, t.mergeId, t.refTable, t.rowId),
    foreignKey({
      name: 'contact_merge_moves_merge_fk',
      columns: [t.orgId, t.mergeId],
      foreignColumns: [contactMerges.orgId, contactMerges.id],
    }).onDelete('cascade'),
    check('contact_merge_moves_module_check', sql`module ~ '^[a-z][a-z_-]{1,40}$'`),
    check('contact_merge_moves_table_check', sql`ref_table ~ '^[a-z][a-z_]{1,40}\\.[a-z][a-z_]{1,60}$'`),
  ],
);

/**
 * Possible duplicates (M6.1a): one row per pair (`contact_a_id < contact_b_id`), with a confidence
 * score (0–100) and the reasons. Kept current by the scan (a background job per org, incremental
 * on new and changed contacts); a dismissed pair is never raised again.
 */
export const duplicateCandidates = tenantTable(
  crmSchema,
  'duplicate_candidates',
  {
    contactAId: uuid('contact_a_id').notNull(),
    contactBId: uuid('contact_b_id').notNull(),
    score: integer('score').notNull(),
    reasons: text('reasons').array().notNull(),
    /** Trigram similarity of the names and companies, in percent (name + company reason). */
    nameSimilarity: integer('name_similarity'),
    companySimilarity: integer('company_similarity'),
    status: text('status').notNull().default('open'),
    detectedAt: tsz('detected_at').notNull(),
    resolvedAt: tsz('resolved_at'),
    resolvedBy: text('resolved_by'),
  },
  (t) => [
    uniqueIndex('duplicate_candidates_org_pair_key').on(t.orgId, t.contactAId, t.contactBId),
    index('duplicate_candidates_org_status_score_idx').on(t.orgId, t.status, t.score, t.id),
    index('duplicate_candidates_org_b_idx').on(t.orgId, t.contactBId),
    foreignKey({
      name: 'duplicate_candidates_a_fk',
      columns: [t.orgId, t.contactAId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'duplicate_candidates_b_fk',
      columns: [t.orgId, t.contactBId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check('duplicate_candidates_order_check', sql`contact_a_id < contact_b_id`),
    check('duplicate_candidates_score_check', sql`score between 0 and 100`),
    check(
      'duplicate_candidates_reasons_check',
      sql`cardinality(reasons) between 1 and 3 and reasons <@ array['email', 'phone', 'name_company']::text[]`,
    ),
    check(
      'duplicate_candidates_similarity_check',
      sql`(name_similarity is null or name_similarity between 0 and 100) and (company_similarity is null or company_similarity between 0 and 100)`,
    ),
    check('duplicate_candidates_status_check', inCheck('status', DUPLICATE_STATUSES)),
    check('duplicate_candidates_resolved_check', sql`(status = 'open') = (resolved_at is null)`),
    check('duplicate_candidates_resolved_by_check', sql`resolved_by is null or length(resolved_by) <= 200`),
  ],
);

/** Per org: how far the duplicate scan got (contacts changed after `cursor_at` are scanned next). */
export const duplicateScans = tenantTable(
  crmSchema,
  'duplicate_scans',
  {
    cursorAt: tsz('cursor_at'),
    lastRunAt: tsz('last_run_at').notNull(),
    lastFullAt: tsz('last_full_at'),
    contactsScanned: integer('contacts_scanned').notNull().default(0),
    pairsFound: integer('pairs_found').notNull().default(0),
  },
  (t) => [
    uniqueIndex('duplicate_scans_org_key').on(t.orgId),
    check('duplicate_scans_counts_check', sql`contacts_scanned >= 0 and pairs_found >= 0`),
  ],
);

/**
 * The person timeline (M6.1a): a projection, one row per fact, written only by the owning
 * modules' outbox subscribers through `recordTimelineTx` (exactly once per `(kind, source_ref)`).
 * Reads never join other modules. `subject_*` names the row that ties the fact to the person
 * (an order, an attendee record…): a merge undo moves an entry back with its subject.
 */
export const timelineEntries = tenantTable(
  crmSchema,
  'timeline_entries',
  {
    contactId: uuid('contact_id').notNull(),
    kind: text('kind').notNull(),
    occurredAt: tsz('occurred_at').notNull(),
    eventId: uuid('event_id'),
    sourceRef: uuid('source_ref').notNull(),
    subjectTable: text('subject_table'),
    subjectRef: uuid('subject_ref'),
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    currency: text('currency'),
    /** A short display label (a campaign's or survey's name); never personal data. */
    label: text('label'),
  },
  (t) => [
    uniqueIndex('timeline_entries_org_kind_source_key').on(t.orgId, t.kind, t.sourceRef),
    index('timeline_entries_org_contact_time_idx').on(t.orgId, t.contactId, t.occurredAt, t.id),
    index('timeline_entries_org_subject_idx')
      .on(t.orgId, t.subjectTable, t.subjectRef)
      .where(sql`subject_ref is not null`),
    foreignKey({
      name: 'timeline_entries_contact_fk',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check('timeline_entries_kind_check', inCheck('kind', TIMELINE_KINDS)),
    check('timeline_entries_currency_check', sql`currency is null or currency ~ '^[A-Z]{3}$'`),
    check('timeline_entries_amount_check', sql`(amount_minor is null) = (currency is null)`),
    check(
      'timeline_entries_subject_check',
      sql`(subject_ref is null) = (subject_table is null) and (subject_table is null or subject_table ~ '^[a-z][a-z_]{1,40}\\.[a-z][a-z_]{1,60}$')`,
    ),
    check('timeline_entries_label_length', sql`label is null or length(label) between 1 and 200`),
  ],
);

/**
 * M6.1b signals about a contact that no participation row carries: a session attended
 * (`session.attended@1`, M5.6a session check-in) or a campaign opened (`campaign.opened@1`).
 * One row per (contact, kind, ref): a replayed event changes nothing. Inputs of `contact_scores`.
 */
export const CONTACT_SIGNAL_KINDS = ['session_attended', 'campaign_opened'] as const;
export type ContactSignalKind = (typeof CONTACT_SIGNAL_KINDS)[number];

export const contactSignals = tenantTable(
  crmSchema,
  'contact_signals',
  {
    contactId: uuid('contact_id').notNull(),
    kind: text('kind').notNull(),
    /** The session or campaign the signal is about. */
    refId: uuid('ref_id').notNull(),
    eventId: uuid('event_id'),
    occurredAt: tsz('occurred_at').notNull(),
  },
  (t) => [
    uniqueIndex('contact_signals_org_contact_kind_ref_key').on(t.orgId, t.contactId, t.kind, t.refId),
    foreignKey({
      name: 'contact_signals_contact_fk',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check('contact_signals_kind_check', sql`kind in ('session_attended', 'campaign_opened')`),
  ],
);

/**
 * M6.1b contact stats, one row per contact (with `contact_stats` per currency for lifetime value):
 * events taken part in (frequency), registered and attended, past registrations and no-shows,
 * sessions attended, campaigns opened, first and last seen, the engagement score (0–100) and the
 * no-show propensity (basis points), both from the documented formulas in `stats/formulas.ts`.
 * `monetary_minor` is lifetime value in the org's currency (the RFM "M"). RFM quintiles are
 * computed on read across the org (`stats/rfm.ts`), never stored, so they are never stale.
 * Recomputed from the sources by the audiences projector and its daily rescore (idempotent).
 */
export const contactScores = tenantTable(
  crmSchema,
  'contact_scores',
  {
    contactId: uuid('contact_id').notNull(),
    events: integer('events').notNull().default(0),
    eventsRegistered: integer('events_registered').notNull().default(0),
    eventsAttended: integer('events_attended').notNull().default(0),
    pastRegistered: integer('past_registered').notNull().default(0),
    noShows: integer('no_shows').notNull().default(0),
    sessionsAttended: integer('sessions_attended').notNull().default(0),
    campaignsOpened: integer('campaigns_opened').notNull().default(0),
    orders: integer('orders').notNull().default(0),
    monetaryMinor: bigint('monetary_minor', { mode: 'number' }).notNull().default(0),
    monetaryCurrency: text('monetary_currency').notNull(),
    firstSeenAt: tsz('first_seen_at'),
    lastSeenAt: tsz('last_seen_at'),
    engagementScore: integer('engagement_score').notNull().default(0),
    noShowBps: integer('no_show_bps').notNull(),
    computedAt: tsz('computed_at').notNull(),
  },
  (t) => [
    uniqueIndex('contact_scores_org_contact_key').on(t.orgId, t.contactId),
    index('contact_scores_org_engagement_idx').on(t.orgId, t.engagementScore),
    index('contact_scores_org_no_show_idx').on(t.orgId, t.noShowBps),
    foreignKey({
      name: 'contact_scores_contact_fk',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    check(
      'contact_scores_counts_check',
      sql`events >= 0 and events_registered >= 0 and events_attended >= 0 and past_registered >= 0 and no_shows >= 0 and no_shows <= past_registered and sessions_attended >= 0 and campaigns_opened >= 0 and orders >= 0 and monetary_minor >= 0`,
    ),
    check('contact_scores_engagement_check', sql`engagement_score between 0 and 100`),
    check('contact_scores_no_show_check', sql`no_show_bps between 0 and 10000`),
    check('contact_scores_currency_check', sql`monetary_currency ~ '^[A-Z]{3}$'`),
    check('contact_scores_seen_check', sql`last_seen_at is null or last_seen_at >= first_seen_at`),
  ],
);
