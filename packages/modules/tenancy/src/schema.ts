import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const tenancy = pgSchema('tenancy');

export const ORG_KINDS = ['organizer', 'agency', 'venue', 'platform'] as const;
export const ORG_STATUSES = ['active', 'limited', 'suspended', 'terminated'] as const;
export const ORG_ROLES = [
  'owner',
  'admin',
  'manager',
  'finance',
  'marketing',
  'box_office',
  'scanner',
  'viewer',
] as const;

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const organizations = tenantTable(
  tenancy,
  'organizations',
  {
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('organizer'),
    status: text('status').notNull().default('active'),
    defaultProfile: text('default_profile').notNull().default('other'),
    defaultLocale: text('default_locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('America/New_York'),
    country: text('country').notNull().default('US'),
    currency: text('currency').notNull().default('USD'),
    poweredByVisible: boolean('powered_by_visible').notNull().default(true),
    legacyInstance: text('legacy_instance'),
  },
  () => [
    uniqueIndex('organizations_slug_key').on(sql`slug`),
    check('organizations_org_is_self', sql`org_id = id`),
    check('organizations_kind_check', inList('kind', ORG_KINDS)),
    check('organizations_status_check', inList('status', ORG_STATUSES)),
    check('organizations_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
);

export const memberships = tenantTable(
  tenancy,
  'memberships',
  {
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_key').on(t.orgId, t.userId),
    foreignKey({
      name: 'memberships_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('memberships_role_check', inList('role', ORG_ROLES)),
  ],
);
