import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
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
