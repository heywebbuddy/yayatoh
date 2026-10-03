import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, index, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const webhooksSchema = pgSchema('webhooks');

export const ENDPOINT_STATUSES = ['active', 'disabled'] as const;
export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

/**
 * M6.3b: the org's webhook endpoints, mirrored from Svix (which holds the secrets, messages and
 * attempts). The mirror is what the console lists and what the publisher checks before sending
 * (an org with no active endpoint sends nothing). `event_types` empty means every subscribable
 * type. The URL may hold a receiver's own token (Zapier-style hooks), so it is internal.
 */
export const endpoints = tenantTable(
  webhooksSchema,
  'endpoints',
  {
    providerEndpointId: text('provider_endpoint_id').notNull(),
    url: text('url').notNull(),
    description: text('description').notNull().default(''),
    eventTypes: text('event_types').array().notNull().default(sql`'{}'::text[]`),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by'),
  },
  (t) => [
    uniqueIndex('endpoints_org_provider_key').on(t.orgId, t.providerEndpointId),
    index('endpoints_org_status_idx').on(t.orgId, t.status),
    check('endpoints_status_check', sql`status in ('active', 'disabled')`),
    check('endpoints_url_check', sql`url ~ '^https://' and length(url) <= 2048`),
    check('endpoints_description_check', sql`length(description) <= 200`),
  ],
);
