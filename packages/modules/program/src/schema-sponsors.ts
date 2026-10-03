import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { exhibitors, programSchema, sessions, sponsors, sponsorTiers } from './schema.ts';

/**
 * M5.4b: sponsor packages and deliverables (program's sponsors area, ADR 0021) and lead licenses
 * (its exhibitors area, P5-4). A package is the terms of a sponsor tier: price, how many are sold,
 * and the bundle of event-level allowances it grants (comp registrations, exhibitor badges, lead
 * licenses, logo placements, session slots). A grant snapshots those allowances for one sponsor,
 * so a later edit of the package never changes what a sponsor bought. Composite (org_id, event_id)
 * keys to `events.events` and the portal-account key are hand-written in the migration.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);
const orgFk = (
  name: string,
  cols: [AnyPgColumn, AnyPgColumn],
  target: { orgId: AnyPgColumn; id: AnyPgColumn },
) => foreignKey({ name, columns: cols, foreignColumns: [target.orgId, target.id] });

/** Where a sponsor's logo appears (the organizer's promise; shown to the sponsor). */
export const LOGO_PLACEMENTS = ['website', 'agenda', 'badges', 'signage', 'stage', 'emails'] as const;
export type LogoPlacement = (typeof LOGO_PLACEMENTS)[number];
export const GRANT_STATUSES = ['pending', 'active', 'cancelled'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];
/** `purchase`: paid online through orders (fake provider in dev/CI); `organizer`: granted in the console. */
export const GRANT_SOURCES = ['purchase', 'organizer'] as const;
export const DELIVERABLE_OWNERS = ['sponsor', 'organizer'] as const;
export type DeliverableOwner = (typeof DELIVERABLE_OWNERS)[number];
export const DELIVERABLE_STATUSES = ['open', 'done'] as const;
export const PURCHASE_STATUSES = ['pending', 'active', 'cancelled'] as const;

/** The terms of one sponsor tier ("Gold"): one row per tier, made when the organizer saves them. */
export const sponsorPackages = tenantTable(
  programSchema,
  'sponsor_packages',
  {
    eventId: uuid('event_id').notNull(),
    tierId: uuid('tier_id').notNull(),
    description: text('description').notNull().default(''),
    /** Null: not sold online (the organizer grants it). */
    priceMinor: minor('price_minor'),
    currency: text('currency').notNull(),
    /** How many sponsors may hold it (active and held purchases); null = no limit. */
    quantity: integer('quantity'),
    onSale: boolean('on_sale').notNull().default(false),
    compRegistrations: integer('comp_registrations').notNull().default(0),
    exhibitorBadges: integer('exhibitor_badges').notNull().default(0),
    leadLicenses: integer('lead_licenses').notNull().default(0),
    logoPlacements: text('logo_placements').array().notNull().default(sql`'{}'::text[]`),
    sessionSlots: integer('session_slots').notNull().default(0),
    /** Deliverables every holder gets: `[{ title, owner, daysBefore }]` (due before the event starts). */
    deliverables: jsonb('deliverables').notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    uniqueIndex('sponsor_packages_org_tier_key').on(t.orgId, t.tierId),
    index('sponsor_packages_org_event_idx').on(t.orgId, t.eventId),
    orgFk('sponsor_packages_tier_fk', [t.orgId, t.tierId], sponsorTiers).onDelete('cascade'),
    check('sponsor_packages_description_check', sql`char_length(description) <= 1000`),
    check('sponsor_packages_price_check', sql`price_minor is null or price_minor between 1 and 100000000000`),
    check('sponsor_packages_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('sponsor_packages_quantity_check', sql`quantity is null or quantity between 1 and 999`),
    check('sponsor_packages_on_sale_check', sql`not on_sale or price_minor is not null`),
    check(
      'sponsor_packages_allowances_check',
      sql`comp_registrations between 0 and 500 and exhibitor_badges between 0 and 500 and lead_licenses between 0 and 500 and session_slots between 0 and 20`,
    ),
    check(
      'sponsor_packages_placements_check',
      sql.raw(
        `cardinality(logo_placements) <= ${LOGO_PLACEMENTS.length} and logo_placements <@ array[${LOGO_PLACEMENTS.map((p) => `'${p}'`).join(', ')}]::text[]`,
      ),
    ),
    check('sponsor_packages_deliverables_check', sql`jsonb_typeof(deliverables) = 'array'`),
  ],
);

/**
 * One sponsor's package: `pending` while its order waits for payment (held until `hold_until`),
 * `active` once paid or granted by the organizer, `cancelled` after. The allowances are a snapshot
 * of the package at the time. At most one active and one pending grant per sponsor.
 */
export const sponsorGrants = tenantTable(
  programSchema,
  'sponsor_grants',
  {
    eventId: uuid('event_id').notNull(),
    sponsorId: uuid('sponsor_id').notNull(),
    tierId: uuid('tier_id').notNull(),
    status: text('status').notNull().default('pending'),
    source: text('source').notNull(),
    /** The add-on order that pays for it (orders, a higher tier: no FK). */
    orderId: uuid('order_id'),
    holdUntil: ts('hold_until'),
    priceMinor: minor('price_minor').notNull().default(0),
    currency: text('currency').notNull(),
    compRegistrations: integer('comp_registrations').notNull(),
    exhibitorBadges: integer('exhibitor_badges').notNull(),
    leadLicenses: integer('lead_licenses').notNull(),
    logoPlacements: text('logo_placements').array().notNull().default(sql`'{}'::text[]`),
    sessionSlots: integer('session_slots').notNull(),
    activatedAt: ts('activated_at'),
    cancelledAt: ts('cancelled_at'),
    /** Who granted or bought it (an actor label, never an address). */
    grantedBy: text('granted_by').notNull(),
    note: text('note'),
    /** The comp registration code (a ticketing promo code made by registration's subscriber). */
    compCode: text('comp_code'),
    compPromoCodeId: uuid('comp_promo_code_id'),
  },
  (t) => [
    uniqueIndex('sponsor_grants_org_active_key').on(t.orgId, t.sponsorId).where(sql`status = 'active'`),
    uniqueIndex('sponsor_grants_org_pending_key').on(t.orgId, t.sponsorId).where(sql`status = 'pending'`),
    uniqueIndex('sponsor_grants_org_order_key').on(t.orgId, t.orderId).where(sql`order_id is not null`),
    index('sponsor_grants_org_event_tier_idx').on(t.orgId, t.eventId, t.tierId, t.status),
    orgFk('sponsor_grants_sponsor_fk', [t.orgId, t.sponsorId], sponsors).onDelete('cascade'),
    orgFk('sponsor_grants_tier_fk', [t.orgId, t.tierId], sponsorTiers).onDelete('cascade'),
    check('sponsor_grants_status_check', inList('status', GRANT_STATUSES)),
    check('sponsor_grants_source_check', inList('source', GRANT_SOURCES)),
    check('sponsor_grants_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('sponsor_grants_price_check', sql`price_minor >= 0`),
    check(
      'sponsor_grants_allowances_check',
      sql`comp_registrations between 0 and 500 and exhibitor_badges between 0 and 500 and lead_licenses between 0 and 500 and session_slots between 0 and 20`,
    ),
    check('sponsor_grants_active_check', sql`status <> 'active' or activated_at is not null`),
    check('sponsor_grants_pending_check', sql`status <> 'pending' or hold_until is not null`),
    check('sponsor_grants_note_check', sql`note is null or char_length(note) <= 500`),
    check('sponsor_grants_comp_code_check', sql`comp_code is null or comp_code ~ '^[A-Z0-9_-]{3,32}$'`),
  ],
);

/**
 * What M5.4b adds to a sponsor (one row, made on first use): the exhibitor it exhibits as, which
 * receives the package's exhibitor badges and lead licenses. The exhibitor key (`ON DELETE SET
 * NULL (exhibitor_id)`) is hand-written in the migration.
 */
export const sponsorProfiles = tenantTable(
  programSchema,
  'sponsor_profiles',
  {
    eventId: uuid('event_id').notNull(),
    sponsorId: uuid('sponsor_id').notNull(),
    exhibitorId: uuid('exhibitor_id'),
  },
  (t) => [
    uniqueIndex('sponsor_profiles_org_sponsor_key').on(t.orgId, t.sponsorId),
    uniqueIndex('sponsor_profiles_org_exhibitor_key')
      .on(t.orgId, t.exhibitorId)
      .where(sql`exhibitor_id is not null`),
    index('sponsor_profiles_org_event_idx').on(t.orgId, t.eventId),
    orgFk('sponsor_profiles_sponsor_fk', [t.orgId, t.sponsorId], sponsors).onDelete('cascade'),
  ],
);

/**
 * A sponsor's deliverables checklist: what is due from whom ("Send the logo files" by the sponsor,
 * "Print the stage banner" by the organizer), with a due date (the end of that day in the event's
 * time zone: `due_at` is the next midnight there) and the person responsible.
 */
export const sponsorDeliverables = tenantTable(
  programSchema,
  'sponsor_deliverables',
  {
    eventId: uuid('event_id').notNull(),
    sponsorId: uuid('sponsor_id').notNull(),
    title: text('title').notNull(),
    owner: text('owner').notNull(),
    /** The person responsible (free text: "Maya, marketing"). */
    ownerName: text('owner_name'),
    dueAt: ts('due_at').notNull(),
    status: text('status').notNull().default('open'),
    completedAt: ts('completed_at'),
    /** Who ticked it off: `organizer` or `sponsor`. */
    completedBy: text('completed_by'),
    /** Made from the package's template when the package was granted. */
    fromPackage: boolean('from_package').notNull().default(false),
  },
  (t) => [
    index('sponsor_deliverables_org_event_due_idx').on(t.orgId, t.eventId, t.status, t.dueAt),
    index('sponsor_deliverables_org_sponsor_idx').on(t.orgId, t.sponsorId),
    orgFk('sponsor_deliverables_sponsor_fk', [t.orgId, t.sponsorId], sponsors).onDelete('cascade'),
    check('sponsor_deliverables_title_check', sql`char_length(title) between 1 and 120`),
    check('sponsor_deliverables_owner_check', inList('owner', DELIVERABLE_OWNERS)),
    check(
      'sponsor_deliverables_owner_name_check',
      sql`owner_name is null or char_length(owner_name) between 1 and 80`,
    ),
    check('sponsor_deliverables_status_check', inList('status', DELIVERABLE_STATUSES)),
    check('sponsor_deliverables_done_check', sql`(status = 'done') = (completed_at is not null)`),
    check(
      'sponsor_deliverables_completed_by_check',
      sql`completed_by is null or completed_by in ('organizer', 'sponsor')`,
    ),
  ],
);

/** Sessions a sponsor holds a slot for ("Sponsored by …"); at most the active grant's slots. */
export const sponsoredSessions = tenantTable(
  programSchema,
  'sponsored_sessions',
  {
    eventId: uuid('event_id').notNull(),
    sponsorId: uuid('sponsor_id').notNull(),
    sessionId: uuid('session_id').notNull(),
  },
  (t) => [
    uniqueIndex('sponsored_sessions_org_session_key').on(t.orgId, t.sessionId),
    index('sponsored_sessions_org_sponsor_idx').on(t.orgId, t.sponsorId),
    orgFk('sponsored_sessions_sponsor_fk', [t.orgId, t.sponsorId], sponsors).onDelete('cascade'),
    orgFk('sponsored_sessions_session_fk', [t.orgId, t.sessionId], sessions).onDelete('cascade'),
  ],
);

/**
 * Extra lead licenses an exhibitor admin buys (P5-4: the organizer's add-on). `pending` while the
 * order waits for payment; `active` adds `quantity` to the exhibitor's licenses.
 */
export const leadLicensePurchases = tenantTable(
  programSchema,
  'lead_license_purchases',
  {
    eventId: uuid('event_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: minor('unit_price_minor').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('pending'),
    orderId: uuid('order_id'),
    holdUntil: ts('hold_until'),
    activatedAt: ts('activated_at'),
  },
  (t) => [
    uniqueIndex('lead_license_purchases_org_order_key').on(t.orgId, t.orderId).where(sql`order_id is not null`),
    index('lead_license_purchases_org_exhibitor_idx').on(t.orgId, t.exhibitorId, t.status),
    orgFk('lead_license_purchases_exhibitor_fk', [t.orgId, t.exhibitorId], exhibitors).onDelete('cascade'),
    check('lead_license_purchases_quantity_check', sql`quantity between 1 and 100`),
    check('lead_license_purchases_price_check', sql`unit_price_minor >= 1`),
    check('lead_license_purchases_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('lead_license_purchases_status_check', inList('status', PURCHASE_STATUSES)),
    check('lead_license_purchases_active_check', sql`status <> 'active' or activated_at is not null`),
  ],
);

/**
 * A lead license: one named scanning seat (P5-4), held by one of the exhibitor's portal accounts
 * (admin or staff) and reassignable by the exhibitor admin. The account key (cascade) is
 * hand-written in the migration (events is a lower tier).
 */
export const leadLicenses = tenantTable(
  programSchema,
  'lead_licenses',
  {
    eventId: uuid('event_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    accountId: uuid('account_id').notNull(),
  },
  (t) => [
    uniqueIndex('lead_licenses_org_account_key').on(t.orgId, t.accountId),
    index('lead_licenses_org_exhibitor_idx').on(t.orgId, t.exhibitorId),
    orgFk('lead_licenses_exhibitor_fk', [t.orgId, t.exhibitorId], exhibitors).onDelete('cascade'),
  ],
);
