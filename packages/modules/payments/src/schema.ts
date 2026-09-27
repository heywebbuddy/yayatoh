import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, pgSchema, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const paymentsSchema = pgSchema('payments');

/** Webhook dedupe: each provider event is processed at most once. */
export const providerEvents = tenantTable(
  paymentsSchema,
  'provider_events',
  {
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    type: text('type').notNull(),
  },
  (t) => [
    uniqueIndex('provider_events_org_provider_event_key').on(t.orgId, t.provider, t.providerEventId),
    check('provider_events_provider_check', sql`provider in ('fake', 'stripe')`),
  ],
);
