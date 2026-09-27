import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { boolean, check, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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

/**
 * The organization's connected (payout) account (roadmap §5.3): one per org. When charges and
 * payouts are enabled, new orders use `organizer_mor` (direct charges on the account); until
 * then they use `platform_mor` (platform charges, transfers at release).
 */
export const paymentAccounts = tenantTable(
  paymentsSchema,
  'payment_accounts',
  {
    provider: text('provider').notNull(),
    accountId: text('account_id').notNull(),
    accountClass: text('account_class').notNull().default('standard'),
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),
    requirementsDue: text('requirements_due').array().notNull().default(sql`'{}'::text[]`),
    country: text('country').notNull(),
    defaultCurrency: text('default_currency'),
    /** Staff payout hold (M1.3e): releases and transfers wait while set. */
    payoutsHeld: boolean('payouts_held').notNull().default(false),
    holdReason: text('hold_reason'),
    lastEventAt: timestamp('last_event_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('payment_accounts_org_key').on(t.orgId),
    check('payment_accounts_provider_check', sql`provider in ('fake', 'stripe')`),
    check('payment_accounts_class_check', sql`account_class in ('standard', 'express', 'custom')`),
  ],
);
