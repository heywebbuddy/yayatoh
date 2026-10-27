import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
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
import { ATTENDANCE_MODES } from './domain/categories.ts';

export const eventsSchema = pgSchema('events');

export const EVENT_STATUSES = [
  'draft',
  'published',
  'postponed',
  'cancelled',
  'completed',
  'archived',
] as const;
export const EVENT_VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export const EVENT_PROFILES = [
  'wedding',
  'gala',
  'concert',
  'conference',
  'community',
  'tour',
  'agency',
  'other',
] as const;
export const EVENT_ROLES = [
  'event_manager',
  'door_staff',
  'seating_manager',
  'session_scanner',
  'exhibitor_admin',
  'exhibitor_staff',
  'speaker',
  'sponsor_contact',
  'kiosk_operator',
  'venue_viewer',
  // M4.2a (P4-8): an event's co-host (the couple, the gala chair) and planner.
  'co_host',
  'planner',
  // M5.3b: a call-for-papers reviewer (a portal account, P5-7): sees only assigned submissions.
  'cfp_reviewer',
] as const;

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const events = tenantTable(
  eventsSchema,
  'events',
  {
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    tagline: text('tagline'),
    profile: text('profile').notNull().default('other'),
    status: text('status').notNull().default('draft'),
    visibility: text('visibility').notNull().default('public'),
    timezone: text('timezone').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    venueName: text('venue_name'),
    city: text('city'),
    country: text('country'),
    currency: text('currency').notNull().default('USD'),
    publishedAt: ts('published_at'),
    /** M1.4c: the org venue picked for the event (the free-text fields above stay the display copy). */
    venueId: uuid('venue_id'),
    /** M1.4c: platform taxonomy key (`EVENT_CATEGORIES`). */
    category: text('category'),
    /** M1.4d: in person, online or hybrid. The join link lives in `event_private_info`. */
    attendanceMode: text('attendance_mode').notNull().default('in_person'),
    /**
     * U8: the org's own category (`org_categories`). `category` above stays the platform key it maps
     * to (the marketplace taxonomy); a hidden org category keeps its events.
     */
    orgCategoryId: uuid('org_category_id'),
    /**
     * Per-event branding (agreement §3): the event's own accent colour (#rrggbb) on its public
     * pages, over the org's brand kit. Null: the org's colour.
     */
    brandColor: text('brand_color'),
    /**
     * Organizer design options for the public page (theme, heading font, hero layout, hero video
     * link); see `domain/design.ts`. Null: the classic default.
     */
    design: jsonb('design'),
  },
  (t) => [
    uniqueIndex('events_slug_key').on(t.slug),
    check('events_design_check', sql`design is null or jsonb_typeof(design) = 'object'`),
    check('events_brand_color_check', sql`brand_color is null or brand_color ~ '^#[0-9a-f]{6}$'`),
    index('events_org_id_starts_at_idx').on(t.orgId, t.startsAt),
    check('events_status_check', inList('status', EVENT_STATUSES)),
    check('events_visibility_check', inList('visibility', EVENT_VISIBILITIES)),
    check('events_profile_check', inList('profile', EVENT_PROFILES)),
    check('events_time_order_check', sql`ends_at > starts_at`),
    check('events_slug_format_check', sql`slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'`),
    check('events_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    /**
     * U9: orders reference (org, event, currency) and refuse a currency change once one exists;
     * ticket types and promo codes follow it (hand-written FKs).
     */
    uniqueIndex('events_org_id_currency_key').on(t.orgId, t.id, t.currency),
    index('events_org_id_venue_id_idx').on(t.orgId, t.venueId),
    index('events_org_id_category_idx').on(t.orgId, t.category),
    foreignKey({
      columns: [t.category],
      foreignColumns: [platformCategories.key],
      name: 'events_category_fk',
    }),
    check('events_attendance_mode_check', inList('attendance_mode', ATTENDANCE_MODES)),
    index('events_org_id_org_category_id_idx').on(t.orgId, t.orgCategoryId),
    foreignKey({
      name: 'events_org_category_fk',
      columns: [t.orgId, t.orgCategoryId],
      foreignColumns: [orgCategories.orgId, orgCategories.id],
    }),
  ],
);

export const eventRoleAssignments = tenantTable(
  eventsSchema,
  'event_role_assignments',
  {
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    expiresAt: ts('expires_at'),
    /**
     * Door staff scope (M1.9d): the check-in checkpoints this assignment may scan at. Empty = the
     * whole event. The checkin module validates the ids (they belong to the event).
     */
    checkpointIds: uuid('checkpoint_ids').array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [
    uniqueIndex('event_role_assignments_org_event_user_role_key').on(t.orgId, t.eventId, t.userId, t.role),
    index('event_role_assignments_org_user_idx').on(t.orgId, t.userId),
    foreignKey({
      name: 'event_role_assignments_event_fk',
      columns: [t.orgId, t.eventId],
      foreignColumns: [events.orgId, events.id],
    }).onDelete('cascade'),
    check('event_role_assignments_role_check', inList('role', EVENT_ROLES)),
  ],
);

export const OCCURRENCE_STATUSES = ['scheduled', 'cancelled'] as const;

/**
 * M1.4b: the dates of a multi-date (multi-day or recurring) event. An event without rows here is
 * a single-date event (its own `starts_at`/`ends_at`); with rows, the event's times are the span of
 * its scheduled occurrences. A ticket may be bound to one occurrence (`ticketing.tickets`).
 */
export const occurrences = tenantTable(
  eventsSchema,
  'occurrences',
  {
    eventId: uuid('event_id').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    /** Tickets this date may sell across all ticket types; null = only the ticket types' limits. */
    capacity: integer('capacity'),
    status: text('status').notNull().default('scheduled'),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [
    index('occurrences_org_event_starts_idx').on(t.orgId, t.eventId, t.startsAt),
    uniqueIndex('occurrences_org_event_starts_key')
      .on(t.orgId, t.eventId, t.startsAt)
      .where(sql`status = 'scheduled'`),
    foreignKey({
      name: 'occurrences_event_fk',
      columns: [t.orgId, t.eventId],
      foreignColumns: [events.orgId, events.id],
    }).onDelete('cascade'),
    check('occurrences_time_order_check', sql`ends_at > starts_at`),
    check('occurrences_capacity_check', sql`capacity is null or capacity >= 1`),
    check('occurrences_status_check', inList('status', OCCURRENCE_STATUSES)),
    check('occurrences_cancelled_check', sql`(status = 'cancelled') = (cancelled_at is not null)`),
  ],
);

/** M1.4b: a named group of events (a tour, a season). Slugs are global: `/series/{slug}`. */
export const series = tenantTable(
  eventsSchema,
  'series',
  {
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
  },
  (t) => [
    uniqueIndex('series_slug_key').on(t.slug),
    index('series_org_name_idx').on(t.orgId, t.name),
    check('series_slug_format_check', sql`slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'`),
    check('series_name_length_check', sql`length(name) between 2 and 160`),
  ],
);

/** An event belongs to at most one series. */
export const seriesEvents = tenantTable(
  eventsSchema,
  'series_events',
  {
    seriesId: uuid('series_id').notNull(),
    eventId: uuid('event_id').notNull(),
  },
  (t) => [
    uniqueIndex('series_events_org_event_key').on(t.orgId, t.eventId),
    index('series_events_org_series_idx').on(t.orgId, t.seriesId),
    foreignKey({
      name: 'series_events_series_fk',
      columns: [t.orgId, t.seriesId],
      foreignColumns: [series.orgId, series.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'series_events_event_fk',
      columns: [t.orgId, t.eventId],
      foreignColumns: [events.orgId, events.id],
    }).onDelete('cascade'),
  ],
);

/**
 * U8 (UX-2): the platform's default category list, managed by staff in admin. Global reference
 * data (GLOBAL_TABLES): one row per taxonomy key; `in_defaults` and `position` decide which
 * categories a new org list starts with and in what order. app_user reads it; staff change it
 * only through the SECURITY DEFINER `events.set_platform_default_categories`.
 */
export const platformCategories = eventsSchema.table(
  'platform_categories',
  {
    key: text('key').primaryKey(),
    label: text('label'),
    position: integer('position').notNull(),
    inDefaults: boolean('in_defaults').notNull().default(true),
    updatedBy: text('updated_by').notNull().default('migration'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('platform_categories_key_check', sql`key ~ '^[a-z][a-z0-9_]{0,59}$'`),
    check(
      'platform_categories_label_check',
      sql`label is null or char_length(btrim(label)) between 1 and 60`,
    ),
    uniqueIndex('platform_categories_label_unique').on(sql`lower(${t.label})`).where(sql`label is not null`),
  ],
);

/** Organization-specific names and visibility; platform keys remain stable. */
export const orgCategories = tenantTable(
  eventsSchema,
  'org_categories',
  {
    platformKey: text('platform_key').notNull(),
    name: text('name'),
    position: integer('position').notNull(),
    hiddenAt: ts('hidden_at'),
  },
  (t) => [
    index('org_categories_org_id_position_idx').on(t.orgId, t.position),
    uniqueIndex('org_categories_org_name_key')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`name is not null`),
    uniqueIndex('org_categories_org_default_key').on(t.orgId, t.platformKey).where(sql`name is null`),
    foreignKey({
      columns: [t.platformKey],
      foreignColumns: [platformCategories.key],
      name: 'org_categories_platform_key_fk',
    }),
    check('org_categories_name_check', sql`name is null or char_length(name) between 1 and 60`),
  ],
);
