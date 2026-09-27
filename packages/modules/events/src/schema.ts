import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
  },
  (t) => [
    uniqueIndex('events_slug_key').on(t.slug),
    index('events_org_id_starts_at_idx').on(t.orgId, t.startsAt),
    check('events_status_check', inList('status', EVENT_STATUSES)),
    check('events_visibility_check', inList('visibility', EVENT_VISIBILITIES)),
    check('events_profile_check', inList('profile', EVENT_PROFILES)),
    check('events_time_order_check', sql`ends_at > starts_at`),
    check('events_slug_format_check', sql`slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'`),
    check('events_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
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
