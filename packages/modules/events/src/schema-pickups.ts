import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, text, uuid } from 'drizzle-orm/pg-core';
import { events, eventsSchema } from './schema.ts';

/**
 * Tours: where a departure picks passengers up. Each point has a name, an address and a time
 * offset ("minutes before departure"), so one list serves every departure of a repeating tour.
 * The buyer chooses one at checkout (a checkout question the web keeps in step with this list) and
 * it is shown on their order.
 */
export const eventPickupPoints = tenantTable(
  eventsSchema,
  'event_pickup_points',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    address: text('address').notNull().default(''),
    /** Passengers are asked to be here this many minutes before the departure time. */
    minutesBefore: integer('minutes_before').notNull().default(0),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('event_pickup_points_org_event_position_idx').on(t.orgId, t.eventId, t.position),
    foreignKey({
      name: 'event_pickup_points_event_fk',
      columns: [t.orgId, t.eventId],
      foreignColumns: [events.orgId, events.id],
    }).onDelete('cascade'),
    check('event_pickup_points_name_check', sql`char_length(name) between 1 and 80`),
    check('event_pickup_points_address_check', sql`char_length(address) <= 200`),
    check('event_pickup_points_minutes_check', sql`minutes_before between 0 and 720`),
    check('event_pickup_points_position_check', sql`position >= 0`),
  ],
);
