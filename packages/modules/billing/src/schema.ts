import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
