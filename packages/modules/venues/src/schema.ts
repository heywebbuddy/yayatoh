import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const venuesSchema = pgSchema('venues');

export const QUOTE_STATUSES = ['new', 'handled'] as const;

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * An org's venue. `slug` is global (public URL `/venues/{slug}`); only `directory_listed` venues
 * of active orgs appear in the platform directory.
 */
export const venues = tenantTable(
  venuesSchema,
  'venues',
  {
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    country: text('country').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    timezone: text('timezone').notNull(),
    capacity: integer('capacity'),
    accessibilityNotes: text('accessibility_notes'),
    mapUrl: text('map_url'),
    directoryListed: boolean('directory_listed').notNull().default(false),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    uniqueIndex('venues_slug_key').on(t.slug),
    index('venues_org_id_name_idx').on(t.orgId, t.name),
    check('venues_slug_format_check', sql`slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'`),
    check('venues_country_check', sql`country ~ '^[A-Z]{2}$'`),
    check('venues_capacity_check', sql`capacity is null or capacity > 0`),
    check(
      'venues_geo_check',
      sql`(latitude is null) = (longitude is null) and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))`,
    ),
    check('venues_map_url_check', sql`map_url is null or map_url ~ '^https://'`),
  ],
);

/** A public "request a quote" enquiry about one venue. Contact data: organizer eyes only. */
export const quoteRequests = tenantTable(
  venuesSchema,
  'quote_requests',
  {
    venueId: uuid('venue_id').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    eventDate: date('event_date', { mode: 'string' }),
    guests: integer('guests'),
    message: text('message').notNull(),
    status: text('status').notNull().default('new'),
    /** HMAC of the sender's network key, for rate limiting only (never the raw address). */
    clientKey: text('client_key').notNull(),
  },
  (t) => [
    index('quote_requests_org_venue_created_idx').on(t.orgId, t.venueId, t.createdAt),
    index('quote_requests_org_client_created_idx').on(t.orgId, t.clientKey, t.createdAt),
    foreignKey({
      name: 'quote_requests_venue_fk',
      columns: [t.orgId, t.venueId],
      foreignColumns: [venues.orgId, venues.id],
    }).onDelete('cascade'),
    check('quote_requests_status_check', sql`status in ('new', 'handled')`),
    check('quote_requests_guests_check', sql`guests is null or guests > 0`),
  ],
);
