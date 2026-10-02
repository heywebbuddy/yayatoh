import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
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
    uniqueIndex('capacity_claims_org_order_key').on(t.orgId, t.orderId),
    index('capacity_claims_org_type_idx').on(t.orgId, t.registrationTypeId),
    check('capacity_claims_quantity_check', sql`quantity_held >= 0 and quantity_sold >= 0`),
    foreignKey({
      name: 'capacity_claims_type_fk',
      columns: [t.orgId, t.registrationTypeId],
      foreignColumns: [registrationTypes.orgId, registrationTypes.id],
    }).onDelete('cascade'),
  ],
);
