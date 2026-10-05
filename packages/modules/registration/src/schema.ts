import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
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

export const registrationSchema = pgSchema('registration');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const ELIGIBILITY_KINDS = ['open', 'access_code', 'email_domain'] as const;
export const ADMISSION_ITEM_KINDS = ['admission', 'add_on'] as const;

/**
 * M5.1a: who registers (Member, Student, VIP…), per event. `capacity` caps the registrants of
 * this type across all its admission items; the counter (`quantity_held` + `quantity_sold`) is
 * claimed with the ticketing hold and can never pass it (CHECK). Eligibility is checked in the
 * checkout command: an access code (stored normalized) or an email domain list.
 */
export const registrationTypes = tenantTable(
  registrationSchema,
  'registration_types',
  {
    eventId: uuid('event_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    capacity: integer('capacity'),
    quantityHeld: integer('quantity_held').notNull().default(0),
    quantitySold: integer('quantity_sold').notNull().default(0),
    eligibility: text('eligibility').notNull().default('open'),
    accessCode: text('access_code'),
    emailDomains: text('email_domains').array().notNull().default(sql`'{}'::text[]`),
    archivedAt: ts('archived_at'),
    // M5.1c: apply-to-attend, auto-approve rules, +1 guest types and substitution.
    approval: text('approval').notNull().default('none'),
    autoApproveDomains: text('auto_approve_domains').array().notNull().default(sql`'{}'::text[]`),
    kind: text('kind').notNull().default('standard'),
    guestsPerHost: integer('guests_per_host').notNull().default(1),
    substitutionCutoffHours: integer('substitution_cutoff_hours').notNull().default(24),
    // M5.1d (P5-5): pay later by invoice (an organizer opt-in per type) and its PO number rule.
    payLater: boolean('pay_later').notNull().default(false),
    poNumber: text('po_number').notNull().default('off'),
  },
  (t) => [
    uniqueIndex('registration_types_org_event_key').on(t.orgId, t.eventId, t.key),
    index('registration_types_org_event_idx').on(t.orgId, t.eventId, t.sortOrder),
    check(
      'registration_types_capacity_check',
      sql`quantity_held >= 0 and quantity_sold >= 0 and (capacity is null or (capacity >= 0 and quantity_held + quantity_sold <= capacity))`,
    ),
    check('registration_types_key_check', sql`key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'`),
    check('registration_types_name_check', sql`length(btrim(name)) between 1 and 80`),
    check(
      'registration_types_eligibility_check',
      sql`eligibility in ('open', 'access_code', 'email_domain')`,
    ),
    check(
      'registration_types_code_check',
      sql`(eligibility = 'access_code') = (access_code is not null) and (access_code is null or access_code ~ '^[A-Z0-9_-]{4,32}$')`,
    ),
    check(
      'registration_types_domains_check',
      sql`(eligibility = 'email_domain') = (cardinality(email_domains) > 0) and cardinality(email_domains) <= 20`,
    ),
    check(
      'registration_types_approval_check',
      sql`approval in ('none', 'manual') and cardinality(auto_approve_domains) <= 20 and (approval = 'manual' or cardinality(auto_approve_domains) = 0)`,
    ),
    check(
      'registration_types_guest_check',
      sql`kind in ('standard', 'guest') and guests_per_host between 1 and 10 and substitution_cutoff_hours between 0 and 720`,
    ),
    check(
      'registration_types_pay_later_check',
      sql`po_number in ('off', 'optional', 'required') and (pay_later or po_number = 'off')`,
    ),
  ],
);

/** M5.1a: what is bought (full pass, day pass, workshop add-on, dinner), per event. */
export const admissionItems = tenantTable(
  registrationSchema,
  'admission_items',
  {
    eventId: uuid('event_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').notNull().default('admission'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    uniqueIndex('admission_items_org_event_key').on(t.orgId, t.eventId, t.key),
    index('admission_items_org_event_idx').on(t.orgId, t.eventId, t.sortOrder),
    check('admission_items_kind_check', sql`kind in ('admission', 'add_on')`),
    check('admission_items_key_check', sql`key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'`),
    check('admission_items_name_check', sql`length(btrim(name)) between 1 and 80`),
  ],
);

/**
 * A type × item cell: offered, at its own price, through exactly one ticket type (managed by
 * registration). Disabling archives the ticket type and the cell; enabling again makes a new
 * cell, so tickets sold through an old one still count for the type.
 */
export const typeItems = tenantTable(
  registrationSchema,
  'type_items',
  {
    eventId: uuid('event_id').notNull(),
    registrationTypeId: uuid('registration_type_id').notNull(),
    admissionItemId: uuid('admission_item_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    uniqueIndex('type_items_org_live_cell_key')
      .on(t.orgId, t.registrationTypeId, t.admissionItemId)
      .where(sql`archived_at is null`),
    uniqueIndex('type_items_org_ticket_type_key').on(t.orgId, t.ticketTypeId),
    index('type_items_org_event_idx').on(t.orgId, t.eventId),
    foreignKey({
      name: 'type_items_type_fk',
      columns: [t.orgId, t.registrationTypeId],
      foreignColumns: [registrationTypes.orgId, registrationTypes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'type_items_item_fk',
      columns: [t.orgId, t.admissionItemId],
      foreignColumns: [admissionItems.orgId, admissionItems.id],
    }).onDelete('cascade'),
  ],
);

/**
 * What one order counts against a type's capacity (its admission tickets), as last applied to
 * the counter. The capacity subscriber recomputes it from the order and applies the difference,
 * so replayed or reordered events change nothing twice.
 */
export const capacityClaims = tenantTable(
  registrationSchema,
  'capacity_claims',
  {
    eventId: uuid('event_id').notNull(),
    registrationTypeId: uuid('registration_type_id').notNull(),
    orderId: uuid('order_id').notNull(),
    quantityHeld: integer('quantity_held').notNull().default(0),
    quantitySold: integer('quantity_sold').notNull().default(0),
  },
  (t) => [
    // M5.1c: a group order counts against each of its registrants' types (one claim per type).
    uniqueIndex('capacity_claims_org_order_type_key').on(t.orgId, t.orderId, t.registrationTypeId),
    index('capacity_claims_org_type_idx').on(t.orgId, t.registrationTypeId),
    check('capacity_claims_quantity_check', sql`quantity_held >= 0 and quantity_sold >= 0`),
    foreignKey({
      name: 'capacity_claims_type_fk',
      columns: [t.orgId, t.registrationTypeId],
      foreignColumns: [registrationTypes.orgId, registrationTypes.id],
    }).onDelete('cascade'),
  ],
);

/** M5.1c: approval and registrant states (see MODULE.md for the transitions). */
export const REGISTRANT_STATUSES = [
  'pending',
  'approved',
  'reserved',
  'confirmed',
  'denied',
  'cancelled',
] as const;
export const DECISION_SOURCES = ['open', 'auto_domain', 'auto_member', 'manual'] as const;
export const APPROVAL_MODES = ['none', 'manual'] as const;
export const TYPE_KINDS = ['standard', 'guest'] as const;

/**
 * M5.1c: one named registrant of one type. Applications (approval types) start `pending` and hold
 * no order: nobody is charged before approval. `approved` places count against the type's room
 * (kept back like open waitlist offers); a group or a single checkout makes `reserved` registrants
 * of its order, confirmed when it is paid. `ticket_id` is the registrant's one admission ticket;
 * a +1 guest names its `host_registrant_id`.
 */
export const registrants = tenantTable(
  registrationSchema,
  'registrants',
  {
    eventId: uuid('event_id').notNull(),
    registrationTypeId: uuid('registration_type_id').notNull(),
    admissionItemId: uuid('admission_item_id').notNull(),
    addOnItemIds: uuid('add_on_item_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: text('status').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    company: text('company'),
    jobTitle: text('job_title'),
    message: text('message'),
    locale: text('locale').notNull().default('en'),
    decisionSource: text('decision_source'),
    decisionReason: text('decision_reason'),
    decidedAt: ts('decided_at'),
    decidedBy: uuid('decided_by'),
    orderId: uuid('order_id'),
    ticketId: uuid('ticket_id'),
    hostRegistrantId: uuid('host_registrant_id'),
    substitutions: integer('substitutions').notNull().default(0),
    confirmedAt: ts('confirmed_at'),
  },
  (t) => [
    index('registrants_org_event_status_idx').on(t.orgId, t.eventId, t.status, t.createdAt),
    index('registrants_org_order_idx').on(t.orgId, t.orderId),
    index('registrants_org_type_idx').on(t.orgId, t.registrationTypeId, t.status),
    index('registrants_org_event_email_idx').on(t.orgId, t.eventId, t.email),
    index('registrants_org_host_idx').on(t.orgId, t.hostRegistrantId),
    uniqueIndex('registrants_org_ticket_key').on(t.orgId, t.ticketId),
    // One live application per address and type.
    uniqueIndex('registrants_org_open_application_key')
      .on(t.orgId, t.registrationTypeId, t.email)
      .where(sql`status in ('pending', 'approved')`),
    check(
      'registrants_status_check',
      sql`status in ('pending', 'approved', 'reserved', 'confirmed', 'denied', 'cancelled')`,
    ),
    check(
      'registrants_decision_source_check',
      sql`decision_source is null or decision_source in ('open', 'auto_domain', 'auto_member', 'manual')`,
    ),
    check('registrants_name_check', sql`length(btrim(name)) between 1 and 120`),
    check('registrants_email_check', sql`email = lower(email) and length(email) between 3 and 254`),
    check(
      'registrants_answers_check',
      sql`coalesce(length(company), 0) <= 120 and coalesce(length(job_title), 0) <= 120 and coalesce(length(message), 0) <= 2000 and coalesce(length(decision_reason), 0) <= 1000`,
    ),
    check('registrants_confirmed_check', sql`status <> 'confirmed' or order_id is not null`),
    foreignKey({
      name: 'registrants_type_fk',
      columns: [t.orgId, t.registrationTypeId],
      foreignColumns: [registrationTypes.orgId, registrationTypes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'registrants_item_fk',
      columns: [t.orgId, t.admissionItemId],
      foreignColumns: [admissionItems.orgId, admissionItems.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'registrants_host_fk',
      columns: [t.orgId, t.hostRegistrantId],
      foreignColumns: [t.orgId, t.id],
    }).onDelete('cascade'),
  ],
);

/**
 * M5.1c: a type's member list for auto-approval (a CSV upload or an audience snapshot): addresses
 * stored lower case. An applicant on the list is approved on applying.
 */
export const typeMembers = tenantTable(
  registrationSchema,
  'type_members',
  {
    eventId: uuid('event_id').notNull(),
    registrationTypeId: uuid('registration_type_id').notNull(),
    email: text('email').notNull(),
    source: text('source').notNull().default('csv'),
  },
  (t) => [
    uniqueIndex('type_members_org_type_email_key').on(t.orgId, t.registrationTypeId, t.email),
    index('type_members_org_event_idx').on(t.orgId, t.eventId),
    check('type_members_source_check', sql`source in ('csv', 'audience')`),
    check('type_members_email_check', sql`email = lower(email) and length(email) between 3 and 254`),
    foreignKey({
      name: 'type_members_type_fk',
      columns: [t.orgId, t.registrationTypeId],
      foreignColumns: [registrationTypes.orgId, registrationTypes.id],
    }).onDelete('cascade'),
  ],
);

/** M5.1c: the organizer's reason templates for approval and denial emails, per event. */
export const reasonTemplates = tenantTable(
  registrationSchema,
  'reason_templates',
  {
    eventId: uuid('event_id').notNull(),
    decision: text('decision').notNull(),
    label: text('label').notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    index('reason_templates_org_event_idx').on(t.orgId, t.eventId, t.decision),
    check('reason_templates_decision_check', sql`decision in ('approve', 'deny')`),
    check(
      'reason_templates_text_check',
      sql`length(btrim(label)) between 1 and 80 and length(btrim(body)) between 1 and 1000`,
    ),
  ],
);

/* ------------------------------------------------------- M5.2b: session enrollment ---- */

export const ENROLLMENT_STATUSES = [
  'enrolled',
  'waiting',
  'offered',
  'dropped',
  'left',
  'expired',
  'declined',
  'skipped',
  'cancelled',
] as const;
/** Why a line entry was passed over on promotion (re-checked then, P5-9). */
export const ENROLLMENT_SKIP_REASONS = [
  'overlap',
  'one_per_group',
  'not_available',
  'registrant_gone',
] as const;
export const PROMOTION_MODES = ['auto', 'offer'] as const;

/**
 * Which sessions an admission item gives (M5.2b). An `admission` item with no rows gives every
 * session; with rows, only those. An `add_on` gives only its rows (none: nothing). Included
 * sessions it gives are on the registrant's schedule; optional ones may be enrolled in.
 * `session_id` names a `program.sessions` row (hand-written composite FK, cascade).
 */
export const itemSessions = tenantTable(
  registrationSchema,
  'item_sessions',
  {
    eventId: uuid('event_id').notNull(),
    admissionItemId: uuid('admission_item_id').notNull(),
    sessionId: uuid('session_id').notNull(),
  },
  (t) => [
    uniqueIndex('item_sessions_org_item_session_key').on(t.orgId, t.admissionItemId, t.sessionId),
    index('item_sessions_org_event_idx').on(t.orgId, t.eventId),
    index('item_sessions_org_session_idx').on(t.orgId, t.sessionId),
    foreignKey({
      name: 'item_sessions_item_fk',
      columns: [t.orgId, t.admissionItemId],
      foreignColumns: [admissionItems.orgId, admissionItems.id],
    }).onDelete('cascade'),
  ],
);

/**
 * An event's session waitlist setting (M5.2b; no row: the P5-9 default). `auto`: a freed place
 * enrols the next person at once (with an email); `offer`: the next person is offered the place
 * for `offer_minutes` and accepts from their schedule. Promotion stops 24 h before a session.
 */
export const enrollmentSettings = tenantTable(
  registrationSchema,
  'enrollment_settings',
  {
    eventId: uuid('event_id').notNull(),
    promotion: text('promotion').notNull().default('auto'),
    offerMinutes: integer('offer_minutes').notNull().default(240),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    uniqueIndex('enrollment_settings_org_event_key').on(t.orgId, t.eventId),
    check('enrollment_settings_promotion_check', sql`promotion in ('auto', 'offer')`),
    check('enrollment_settings_offer_minutes_check', sql`offer_minutes between 15 and 2880`),
  ],
);

/**
 * A registrant's place in an optional session, or their place in its line (M5.2b). The
 * registrant is their admission ticket (`registrant_id`, one per registrant since M5.1a; a
 * substitution keeps the ticket). `enrolled` and `offered` hold one of the session's places
 * (program's counter, claimed atomically); `waiting` holds none. The line is `(position_at, id)`.
 * One live row per registrant and session (unique while enrolled, waiting or offered).
 */
export const sessionEnrollments = tenantTable(
  registrationSchema,
  'session_enrollments',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    registrantId: uuid('registrant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    status: text('status').notNull(),
    positionAt: ts('position_at').notNull(),
    enrolledAt: ts('enrolled_at'),
    offeredAt: ts('offered_at'),
    offerExpiresAt: ts('offer_expires_at'),
    /** How many offers this entry has had (the offer email's dedupe key). */
    offerCount: integer('offer_count').notNull().default(0),
    /** Who moved it off the line: `auto`, `offer` (accepted) or `organizer` ("promote now"). */
    promotedBy: text('promoted_by'),
    skipReason: text('skip_reason'),
    /** A pick-one group place is held with this row (program's `session_group_picks`). */
    picked: boolean('picked').notNull().default(false),
    endedAt: ts('ended_at'),
  },
  (t) => [
    uniqueIndex('session_enrollments_org_live_key')
      .on(t.orgId, t.sessionId, t.registrantId)
      .where(sql`status in ('enrolled', 'waiting', 'offered')`),
    index('session_enrollments_org_queue_idx').on(t.orgId, t.sessionId, t.status, t.positionAt, t.id),
    index('session_enrollments_org_registrant_idx').on(t.orgId, t.registrantId),
    index('session_enrollments_org_event_idx').on(t.orgId, t.eventId, t.status),
    index('session_enrollments_org_order_idx').on(t.orgId, t.orderId),
    index('session_enrollments_org_offer_idx').on(t.orgId, t.offerExpiresAt).where(sql`status = 'offered'`),
    check(
      'session_enrollments_status_check',
      sql.raw(`status in (${ENROLLMENT_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
    check(
      'session_enrollments_offer_check',
      sql`(status = 'offered') = (offer_expires_at is not null and offered_at is not null)`,
    ),
    check(
      'session_enrollments_skip_check',
      sql.raw(
        `(status = 'skipped') = (skip_reason is not null) and (skip_reason is null or skip_reason in (${ENROLLMENT_SKIP_REASONS.map((s) => `'${s}'`).join(', ')}))`,
      ),
    ),
    check(
      'session_enrollments_promoted_check',
      sql`promoted_by is null or promoted_by in ('auto', 'offer', 'organizer')`,
    ),
    check('session_enrollments_offer_count_check', sql`offer_count >= 0`),
  ],
);

/**
 * M5.10a: sessions a registrant starred in the conference hub ("favorites"), apart from
 * enrollment: a favorite holds no place. One row per registrant and session.
 */
export const sessionFavorites = tenantTable(
  registrationSchema,
  'session_favorites',
  {
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    registrantId: uuid('registrant_id').notNull(),
  },
  (t) => [
    uniqueIndex('session_favorites_org_registrant_session_key').on(t.orgId, t.registrantId, t.sessionId),
    index('session_favorites_org_event_idx').on(t.orgId, t.eventId),
    index('session_favorites_org_session_idx').on(t.orgId, t.sessionId),
  ],
);

/**
 * M5.10a: a registrant's signed calendar feed. The feed link carries `version`; "Replace the link"
 * bumps it, so every earlier link stops working. No row = version 1 (never replaced).
 */
export const calendarFeeds = tenantTable(
  registrationSchema,
  'calendar_feeds',
  {
    eventId: uuid('event_id').notNull(),
    registrantId: uuid('registrant_id').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('calendar_feeds_org_registrant_key').on(t.orgId, t.registrantId),
    index('calendar_feeds_org_event_idx').on(t.orgId, t.eventId),
    check('calendar_feeds_version_check', sql`version between 1 and 1000000`),
  ],
);
