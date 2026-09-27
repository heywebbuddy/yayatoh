import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
    /** Brand kit: the accent colour on public pages (#RRGGBB); text on it is chosen for contrast. */
    brandColor: text('brand_color'),
    legacyInstance: text('legacy_instance'),
  },
  () => [
    uniqueIndex('organizations_slug_key').on(sql`slug`),
    check('organizations_org_is_self', sql`org_id = id`),
    check('organizations_kind_check', inList('kind', ORG_KINDS)),
    check('organizations_status_check', inList('status', ORG_STATUSES)),
    check('organizations_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('organizations_brand_color_check', sql`brand_color is null or brand_color ~ '^#[0-9a-f]{6}$'`),
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

/**
 * Pending invitations. No token is stored: the emailed token is an HMAC of the invitation id
 * (domain/invitation-token.ts), so the database and the outbox hold nothing that grants access.
 */
export const invitations = tenantTable(
  tenancy,
  'invitations',
  {
    email: text('email').notNull(),
    role: text('role').notNull(),
    invitedBy: uuid('invited_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('invitations_org_email_pending_key')
      .on(t.orgId, t.email)
      .where(sql`accepted_at is null and revoked_at is null`),
    foreignKey({
      name: 'invitations_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('invitations_role_check', inList('role', ORG_ROLES)),
    check('invitations_email_lower_check', sql`email = lower(email)`),
  ],
);

export const LEGAL_PAGE_KINDS = ['terms', 'privacy', 'refund'] as const;
export type LegalPageKind = (typeof LEGAL_PAGE_KINDS)[number];

/** The organizer's own legal pages (their terms, privacy notice, refund policy), shown publicly. */
export const legalPages = tenantTable(
  tenancy,
  'legal_pages',
  {
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('legal_pages_org_kind_key').on(t.orgId, t.kind),
    check('legal_pages_kind_check', inList('kind', LEGAL_PAGE_KINDS)),
    check('legal_pages_body_length', sql`length(body) between 1 and 50000`),
    foreignKey({
      name: 'legal_pages_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

/** Click-wrap: who accepted which version of the platform's terms or DPA, for this org, when. */
export const agreementAcceptances = tenantTable(
  tenancy,
  'agreement_acceptances',
  {
    document: text('document').notNull(),
    version: text('version').notNull(),
    acceptedBy: uuid('accepted_by').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    uniqueIndex('agreement_acceptances_org_doc_version_key').on(t.orgId, t.document, t.version),
    check('agreement_acceptances_document_check', sql`document in ('platform_tos', 'dpa')`),
    foreignKey({
      name: 'agreement_acceptances_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);
