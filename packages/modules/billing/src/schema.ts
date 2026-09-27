import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, pgSchema, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
