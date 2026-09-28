import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
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
    /**
     * Brand kit logo (M1.4e): the app-origin path of its PNG/JPEG fallback variant (email-safe),
     * and its alt text. Set only by the media module's logo commands, in their transaction.
     */
    logoPath: text('logo_path'),
    logoAlt: text('logo_alt'),
    legacyInstance: text('legacy_instance'),
  },
  () => [
    uniqueIndex('organizations_slug_key').on(sql`slug`),
    check('organizations_org_is_self', sql`org_id = id`),
    check('organizations_kind_check', inList('kind', ORG_KINDS)),
    check('organizations_status_check', inList('status', ORG_STATUSES)),
    check('organizations_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
    check('organizations_brand_color_check', sql`brand_color is null or brand_color ~ '^#[0-9a-f]{6}$'`),
    check(
      'organizations_logo_check',
      sql`(logo_path is null and logo_alt is null) or (logo_path ~ '^/media/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{1,5}-[0-9a-f]{32}[.](png|jpg)$' and length(btrim(logo_alt)) between 1 and 300)`,
    ),
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

export const DOMAIN_KINDS = ['site'] as const;
export const DOMAIN_STATUSES = ['pending_dns', 'verifying', 'active', 'failed'] as const;

/**
 * The organization's hostnames (roadmap §4.4): custom domains the organizer adds, and the managed
 * tenant-apex subdomain (`{slug}.yayatoh.events`) created with the org. A hostname belongs to one
 * org platform-wide (DNS is global), so its unique index is deliberately not org-scoped; the org
 * that already holds it gets `conflict`, and the host router (M1.11) resolves it through a
 * SECURITY DEFINER function returning only the org id.
 */
export const orgDomains = tenantTable(
  tenancy,
  'org_domains',
  {
    hostname: text('hostname').notNull(),
    kind: text('kind').notNull().default('site'),
    /** The tenant-apex subdomain: DNS is the platform's wildcard, so it is active at once. */
    managed: boolean('managed').notNull().default(false),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: text('status').notNull().default('pending_dns'),
    /** The hosting provider's reference (Vercel project domain). */
    providerRef: text('provider_ref'),
    /** DNS records the organizer must publish, as the provider last reported them. */
    records: jsonb('records').notNull().default(sql`'[]'::jsonb`),
    sslStatus: text('ssl_status'),
    /** Stripe Payment Method Domain on the platform account (Apple Pay / Google Pay). */
    paymentMethodDomainId: text('payment_method_domain_id'),
    failureReason: text('failure_reason'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('org_domains_hostname_key').on(t.hostname),
    uniqueIndex('org_domains_org_primary_key').on(t.orgId, t.kind).where(sql`is_primary`),
    check('org_domains_kind_check', inList('kind', DOMAIN_KINDS)),
    check('org_domains_status_check', inList('status', DOMAIN_STATUSES)),
    check('org_domains_primary_active_check', sql`not is_primary or status = 'active'`),
    check(
      'org_domains_hostname_check',
      sql`hostname = lower(hostname) and length(hostname) between 4 and 253 and hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'`,
    ),
    foreignKey({
      name: 'org_domains_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export const SUSPENSION_KINDS = ['pause_checkout', 'pause_publishing', 'pause_messaging'] as const;

/**
 * Staff kill switches per org (roadmap §5, M1.3e): each pauses one capability until lifted.
 * Checked inside the command's own transaction, so a pause applies to the next request.
 */
export const orgSuspensions = tenantTable(
  tenancy,
  'org_suspensions',
  {
    kind: text('kind').notNull(),
    /** Staff-only note (never shown to the organizer). */
    reason: text('reason').notNull(),
    createdBy: text('created_by').notNull(),
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    liftedBy: text('lifted_by'),
  },
  (t) => [
    uniqueIndex('org_suspensions_org_kind_active_key').on(t.orgId, t.kind).where(sql`lifted_at is null`),
    check('org_suspensions_kind_check', inList('kind', SUSPENSION_KINDS)),
    check('org_suspensions_reason_length', sql`length(reason) between 3 and 500`),
    foreignKey({
      name: 'org_suspensions_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export const ORG_STATUS_ACTIONS = ['suspend', 'reactivate', 'terminate'] as const;

/**
 * Staff changes of the org's status (M1.3f): suspended (public pages and sales offline, the
 * console read-only), reactivated, terminated (irreversible from the console). The staff reason
 * stays here and in the audit log; organizers never see it. Rows are history: never updated.
 */
export const orgStatusChanges = tenantTable(
  tenancy,
  'org_status_changes',
  {
    action: text('action').notNull(),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    /** Staff-only note (never shown to the organizer). */
    reason: text('reason').notNull(),
    changedBy: text('changed_by').notNull(),
  },
  (t) => [
    index('org_status_changes_org_created_idx').on(t.orgId, t.createdAt),
    check('org_status_changes_action_check', inList('action', ORG_STATUS_ACTIONS)),
    check('org_status_changes_from_check', inList('from_status', ORG_STATUSES)),
    check('org_status_changes_to_check', inList('to_status', ORG_STATUSES)),
    check('org_status_changes_reason_length', sql`length(reason) between 3 and 500`),
    foreignKey({
      name: 'org_status_changes_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Scopes an org API key may carry (roadmap §6.1). Each is an org permission; a key never gets
 * more than the member who creates it holds, and never the member-management or payout powers.
 */
export const API_KEY_SCOPES = [
  'org:read',
  'events:read',
  'events:write',
  'orders:read',
  'orders:refund',
  'attendees:read',
  'checkin:scan',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * What a test key (`yy_test_…`, `sandbox`) may carry: read-only and no personal data (M1.13d,
 * pending owner). Test keys live in laptops, CI logs and demo apps, so they can neither change
 * anything nor read buyers or attendees. A linked sandbox org with fake-provider orders would be
 * a later relaxation, not a break.
 */
export const TEST_KEY_SCOPES = ['org:read', 'events:read'] as const satisfies readonly ApiKeyScope[];

/**
 * Org API keys (`yy_live_…`; `yy_test_…` test keys have `sandbox`). Only a SHA-256 of the secret
 * is stored; the key is shown once. The
 * key alone resolves to (org, key) through the SECURITY DEFINER `tenancy.api_key_by_hash`, so
 * its hash index is deliberately global. Revoked keys resolve to nothing.
 */
export const apiKeys = tenantTable(
  tenancy,
  'api_keys',
  {
    name: text('name').notNull(),
    /** The first characters of the key (`yy_live_AbC1`), shown in lists to tell keys apart. */
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdBy: uuid('created_by'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
    /** A test key (`yy_test_…`): read-only, non-personal scopes only (`TEST_KEY_SCOPES`). */
    sandbox: boolean('sandbox').notNull().default(false),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_key').on(t.keyHash),
    check('api_keys_name_length', sql`length(name) between 1 and 60`),
    check(
      'api_keys_scopes_check',
      sql`cardinality(scopes) >= 1 and scopes <@ array[${sql.raw(API_KEY_SCOPES.map((s) => `'${s}'`).join(', '))}]::text[]`,
    ),
    check(
      'api_keys_sandbox_check',
      sql`(not sandbox and starts_with(prefix, 'yy_live_')) or (sandbox and starts_with(prefix, 'yy_test_') and scopes <@ array[${sql.raw(TEST_KEY_SCOPES.map((s) => `'${s}'`).join(', '))}]::text[])`,
    ),
    foreignKey({
      name: 'api_keys_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export const ORG_RELATIONSHIP_KINDS = ['agency_client', 'host_affiliate', 'venue_partner'] as const;

/**
 * Parent → child org links (roadmap §4.1). Owned by the parent (`org_id`): e.g. the ABC org hosts
 * its affiliates' events on abc.yayatoh.com (`host_affiliate`, created by the legacy migration).
 * Access grants, commission and billing modes land with agencies (M3.x).
 */
export const orgRelationships = tenantTable(
  tenancy,
  'org_relationships',
  {
    childOrgId: uuid('child_org_id').notNull(),
    kind: text('kind').notNull(),
    /** Where the link came from, e.g. `legacy:abc` for the migration. */
    source: text('source').notNull(),
    detachedAt: timestamp('detached_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('org_relationships_org_child_kind_key').on(t.orgId, t.childOrgId, t.kind),
    check('org_relationships_kind_check', inList('kind', ORG_RELATIONSHIP_KINDS)),
    check('org_relationships_not_self', sql`child_org_id <> org_id`),
    foreignKey({
      name: 'org_relationships_org_fk',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'org_relationships_child_fk',
      columns: [t.childOrgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);
