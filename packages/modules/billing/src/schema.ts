import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const billing = pgSchema('billing');

// Global reference data (listed in GLOBAL_TABLES; app_user has SELECT only).
export const plans = billing.table('plans', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
});

export const planModules = billing.table(
  'plan_modules',
  {
    planKey: text('plan_key')
      .notNull()
      .references(() => plans.key),
    moduleKey: text('module_key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.planKey, t.moduleKey] })],
);

export const orgPlans = tenantTable(
  billing,
  'org_plans',
  {
    planKey: text('plan_key')
      .notNull()
      .references(() => plans.key),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('org_plans_org_key').on(t.orgId)],
);

export const entitlementOverrides = tenantTable(
  billing,
  'entitlement_overrides',
  {
    moduleKey: text('module_key').notNull(),
    effect: text('effect').notNull(),
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('entitlement_overrides_org_module_key').on(t.orgId, t.moduleKey),
    check('entitlement_overrides_effect_check', sql`effect in ('grant', 'revoke')`),
  ],
);

/**
 * Platform fee per plan and currency (global reference data; roadmap §4.5 fee schedules).
 * `launch_standard` rows are seeded at 0 until the owner confirms today's legacy commission.
 */
export const feeSchedules = billing.table(
  'fee_schedules',
  {
    planKey: text('plan_key')
      .notNull()
      .references(() => plans.key),
    currency: text('currency').notNull(),
    percentBps: integer('percent_bps').notNull().default(0),
    fixedMinor: bigint('fixed_minor', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.planKey, t.currency] }),
    check('fee_schedules_bounds_check', sql`percent_bps between 0 and 5000 and fixed_minor >= 0`),
  ],
);

/** Per-org fee override (negotiated rates), set only by platform staff. */
export const orgFeeOverrides = tenantTable(
  billing,
  'org_fee_overrides',
  {
    currency: text('currency').notNull(),
    percentBps: integer('percent_bps').notNull(),
    fixedMinor: bigint('fixed_minor', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
  },
  (t) => [
    uniqueIndex('org_fee_overrides_org_currency_key').on(t.orgId, t.currency),
    check('org_fee_overrides_bounds_check', sql`percent_bps between 0 and 5000 and fixed_minor >= 0`),
  ],
);

/**
 * Add-on catalog (P4-4/P5-11 pattern; global reference data written only by migrations). An
 * `event_addon` is bought (or, in beta, granted free) per event; `price_minor` null means free in
 * beta, so a price switches on with a data change. `quotas` are the per-event limits the owning
 * module enforces (e.g. `conference_pack`: registration types, admission items, registrants).
 */
export const addons = billing.table(
  'addons',
  {
    key: text('key').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    modules: text('modules').array().notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }),
    currency: text('currency'),
    quotas: jsonb('quotas').$type<Record<string, number>>().notNull(),
  },
  () => [
    check('addons_kind_check', sql`kind in ('event_addon')`),
    check(
      'addons_price_check',
      sql`(price_minor is null) = (currency is null) and (price_minor is null or price_minor >= 0)`,
    ),
    check('addons_quotas_check', sql`jsonb_typeof(quotas) = 'object'`),
  ],
);

/** An add-on active for one event of the org (how it was obtained, the price then). */
export const eventAddons = tenantTable(
  billing,
  'event_addons',
  {
    eventId: uuid('event_id').notNull(),
    addonKey: text('addon_key')
      .notNull()
      .references(() => addons.key),
    source: text('source').notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency'),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('event_addons_org_event_addon_key').on(t.orgId, t.eventId, t.addonKey),
    check('event_addons_source_check', sql`source in ('beta_free', 'purchase', 'override')`),
    check('event_addons_price_check', sql`price_minor >= 0`),
  ],
);

/*
 * M6.6a: subscription billing, built dormant (P6-7). The plan catalog below mirrors the billing
 * provider (Stripe Billing: products, prices, Entitlement Features) through the `BillingProvider`
 * port; it is global reference data that app_user only reads. Migrations seed the placeholder
 * tiers (switched off) and the worker's catalog sync (`billing.apply_catalog`, platform_reader)
 * keeps them in step with the provider.
 */

/** Plans offered through the provider (one provider product each); `active` false = switched off. */
export const planCatalog = billing.table(
  'plan_catalog',
  {
    planKey: text('plan_key')
      .primaryKey()
      .references(() => plans.key),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(false),
    providerProductId: text('provider_product_id'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
  },
  () => [check('plan_catalog_sort_check', sql`sort_order between 0 and 1000`)],
);

/**
 * A plan's prices, keyed by the provider price's lookup key (`tier_pro_month_usd`), so a
 * subscription maps to a plan without a catalog call. `unit_amount_minor` null = quoted.
 */
export const planPrices = billing.table(
  'plan_prices',
  {
    lookupKey: text('lookup_key').primaryKey(),
    planKey: text('plan_key')
      .notNull()
      .references(() => plans.key),
    currency: text('currency').notNull(),
    billingInterval: text('billing_interval').notNull(),
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'number' }),
    active: boolean('active').notNull().default(false),
    providerPriceId: text('provider_price_id'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
  },
  () => [
    check('plan_prices_lookup_key_check', sql`lookup_key ~ '^[a-z0-9][a-z0-9_]{2,80}$'`),
    check('plan_prices_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('plan_prices_interval_check', sql`billing_interval in ('month', 'year')`),
    check('plan_prices_amount_check', sql`unit_amount_minor is null or unit_amount_minor >= 0`),
  ],
);

/** The provider's Entitlement Features: one per module key (the feature's lookup key). */
export const billingFeatures = billing.table('features', {
  moduleKey: text('module_key').primaryKey(),
  providerFeatureId: text('provider_feature_id'),
  active: boolean('active').notNull().default(true),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
});

/**
 * The org's billing record: its provider customer (none until billing is switched on for it) and
 * whether its legacy per-ticket fees are grandfathered (P6-7). `entitlements_synced_at` orders the
 * provider's entitlement summaries (an older one never overwrites a newer one).
 */
export const orgBilling = tenantTable(
  billing,
  'org_billing',
  {
    provider: text('provider'),
    providerCustomerId: text('provider_customer_id'),
    legacyFeesGrandfathered: boolean('legacy_fees_grandfathered').notNull().default(false),
    grandfatheredReason: text('grandfathered_reason'),
    entitlementsSyncedAt: timestamp('entitlements_synced_at', { withTimezone: true }),
    /** M6.6b dunning: the renewal failed at this time (the provider's event time); null = paid up. */
    dunningStartedAt: timestamp('dunning_started_at', { withTimezone: true }),
    /** M6.6b: writes keep working until here; then the org is read-only until it pays. */
    graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
    /** M6.6b: the provider gave up retrying (or the subscription ended unpaid): read-only now. */
    readOnlyAt: timestamp('read_only_at', { withTimezone: true }),
    /** M6.6b nonprofit discount: `verified_charity` (M4.8b profile) or `staff`; null = none. */
    nonprofitDiscount: text('nonprofit_discount'),
    /** M6.6b: when the discount last changed, and when the provider last received it. */
    discountChangedAt: timestamp('discount_changed_at', { withTimezone: true }),
    discountPushedAt: timestamp('discount_pushed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('org_billing_org_key').on(t.orgId),
    check(
      'org_billing_nonprofit_discount_check',
      sql`nonprofit_discount is null or nonprofit_discount in ('verified_charity', 'staff')`,
    ),
    check(
      'org_billing_dunning_check',
      sql`(dunning_started_at is null) = (grace_ends_at is null) and (read_only_at is null or dunning_started_at is not null)`,
    ),
    check('org_billing_customer_check', sql`(provider is null) = (provider_customer_id is null)`),
    check('org_billing_provider_check', sql`provider is null or provider in ('fake', 'stripe')`),
    check(
      'org_billing_grandfathered_check',
      sql`(legacy_fees_grandfathered = (grandfathered_reason is not null)) and (grandfathered_reason is null or grandfathered_reason in ('existing_org', 'legacy_migration', 'staff'))`,
    ),
  ],
);

/** The org's provider subscriptions as the provider last reported them (webhooks only). */
export const subscriptions = tenantTable(
  billing,
  'subscriptions',
  {
    provider: text('provider').notNull(),
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    providerCustomerId: text('provider_customer_id').notNull(),
    status: text('status').notNull(),
    /** The plan the subscribed price belongs to; null when the price is not in the catalog. */
    planKey: text('plan_key').references(() => plans.key),
    priceLookupKey: text('price_lookup_key'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    /** The provider's timestamp of the event last applied (older events are skipped). */
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('subscriptions_org_provider_sub_key').on(t.orgId, t.provider, t.providerSubscriptionId),
    check(
      'subscriptions_status_check',
      sql`status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')`,
    ),
    check('subscriptions_provider_check', sql`provider in ('fake', 'stripe')`),
  ],
);

/** The module keys the provider's last entitlement summary granted the org. */
export const orgEntitlements = tenantTable(
  billing,
  'org_entitlements',
  {
    moduleKey: text('module_key').notNull(),
    provider: text('provider').notNull(),
  },
  (t) => [
    uniqueIndex('org_entitlements_org_module_key').on(t.orgId, t.moduleKey),
    check('org_entitlements_provider_check', sql`provider in ('fake', 'stripe')`),
  ],
);

/** Provider webhook events already applied (deduplicated by the provider's event id). */
export const billingProviderEvents = tenantTable(
  billing,
  'provider_events',
  {
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    type: text('type').notNull(),
  },
  (t) => [
    uniqueIndex('provider_events_org_provider_event_key').on(t.orgId, t.provider, t.providerEventId),
    check('billing_provider_events_provider_check', sql`provider in ('fake', 'stripe')`),
  ],
);

/* ------------------------------------------------------------------------------------------------
 * M6.6b — meters, plan changes and dunning.
 * --------------------------------------------------------------------------------------------- */

/**
 * Usage the org's outbox events recorded, one row per (source event, meter): an event delivered
 * twice, or replayed, never counts twice. `reported_at` is set once the billing provider's meter
 * accepted the row (its identifier is the row's id, so a retried report is deduplicated there too).
 */
export const usageRecords = tenantTable(
  billing,
  'usage_records',
  {
    meter: text('meter').notNull(),
    /** Units: messages (SMS: segments), credits (a refund is negative), devices enrolled. */
    quantity: integer('quantity').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    sourceType: text('source_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    reportAttempts: integer('report_attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('usage_records_org_event_meter_key').on(t.orgId, t.sourceEventId, t.meter),
    index('usage_records_org_occurred_idx').on(t.orgId, t.occurredAt),
    index('usage_records_org_unreported_idx').on(t.orgId, t.createdAt).where(sql`reported_at is null`),
    check('usage_records_meter_check', sql`meter in ('email', 'sms', 'whatsapp', 'ai_credits', 'devices')`),
    check('usage_records_quantity_check', sql`quantity <> 0 and quantity between -1000000 and 1000000`),
    check('usage_records_attempts_check', sql`report_attempts >= 0`),
  ],
);

/**
 * In-app plan changes (M6.6b): what the organizer confirmed after the proration preview. The
 * provider's webhook, not this row, changes the subscription and the modules.
 */
export const planChanges = tenantTable(
  billing,
  'plan_changes',
  {
    fromPlanKey: text('from_plan_key'),
    toPlanKey: text('to_plan_key').notNull(),
    priceLookupKey: text('price_lookup_key').notNull(),
    direction: text('direction').notNull(),
    currency: text('currency').notNull(),
    /** What the provider's preview said was due now (proration after discount, plus tax). */
    amountDueMinor: bigint('amount_due_minor', { mode: 'number' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull(),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull(),
    /** Modules the change turns off (a downgrade), confirmed by the organizer first. */
    removedModules: text('removed_modules').array().notNull().default(sql`'{}'::text[]`),
    status: text('status').notNull().default('requested'),
    requestedBy: text('requested_by').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
  },
  (t) => [
    uniqueIndex('plan_changes_org_idempotency_key').on(t.orgId, t.idempotencyKey),
    index('plan_changes_org_created_idx').on(t.orgId, t.createdAt),
    check('plan_changes_direction_check', sql`direction in ('upgrade', 'downgrade', 'switch', 'start')`),
    check('plan_changes_status_check', sql`status in ('requested', 'submitted', 'failed')`),
    check('plan_changes_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('plan_changes_tax_check', sql`tax_minor >= 0 and discount_minor >= 0`),
  ],
);
