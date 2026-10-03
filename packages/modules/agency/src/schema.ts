import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const agency = pgSchema('agency');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Agency v1 (M6.7a): one row per client, owned by the **agency** (`org_id`). The agency's Clients,
 * Marketing and Reports pages read only these rows (and the live grant list), never the client's
 * tables. `refreshAgencySnapshots` rewrites them from the client's projections and exported read
 * functions, under the client's tenant and the grant in force at that moment: money (`revenue`)
 * is filled only when the client opted in to finance, and is hidden again at read time if the
 * opt-in is withdrawn. Rows of clients whose grant ended are deleted on the next refresh and are
 * never shown meanwhile (pages join the live grants).
 */
export const clientSnapshots = tenantTable(
  agency,
  'client_snapshots',
  {
    clientOrgId: uuid('client_org_id').notNull(),
    /** The grant in force when the row was computed. */
    grantId: uuid('grant_id').notNull(),
    eventsTotal: integer('events_total').notNull().default(0),
    eventsUpcoming: integer('events_upcoming').notNull().default(0),
    eventsLive: integer('events_live').notNull().default(0),
    /** The next event (published or draft, not ended) and when it starts. */
    nextEventName: text('next_event_name'),
    nextEventAt: ts('next_event_at'),
    ordersSold: integer('orders_sold').notNull().default(0),
    ticketsValid: integer('tickets_valid').notNull().default(0),
    checkins: integer('checkins').notNull().default(0),
    /** Marketing, last 30 days in the client's time zone (marketing analytics totals). */
    campaigns: integer('campaigns').notNull().default(0),
    sends: integer('sends').notNull().default(0),
    deliveries: integer('deliveries').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    uniqueClickers: integer('unique_clickers').notNull().default(0),
    conversionBps: integer('conversion_bps').notNull().default(0),
    /** Gross sales per currency (minor units), only with the client's finance opt-in. */
    revenue: jsonb('revenue').$type<Record<string, number>>(),
    withFinance: boolean('with_finance').notNull().default(false),
    refreshedAt: ts('refreshed_at').notNull(),
  },
  (t) => [
    uniqueIndex('client_snapshots_org_client_key').on(t.orgId, t.clientOrgId),
    check('client_snapshots_finance_check', sql`with_finance or revenue is null`),
  ],
);

/** One row per client event (M6.7a), owned by the agency: the cross-client Events page. */
export const eventSnapshots = tenantTable(
  agency,
  'event_snapshots',
  {
    clientOrgId: uuid('client_org_id').notNull(),
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    timezone: text('timezone').notNull(),
    ordersSold: integer('orders_sold').notNull().default(0),
    ticketsValid: integer('tickets_valid').notNull().default(0),
    checkins: integer('checkins').notNull().default(0),
    /** Gross sales in the event's currency (minor units), only with the finance opt-in. */
    grossMinor: bigint('gross_minor', { mode: 'number' }),
    currency: text('currency').notNull(),
    refreshedAt: ts('refreshed_at').notNull(),
  },
  (t) => [
    uniqueIndex('event_snapshots_org_client_event_key').on(t.orgId, t.clientOrgId, t.eventId),
    check('event_snapshots_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
);
