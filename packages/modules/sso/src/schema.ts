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

export const ssoSchema = pgSchema('sso');

export const SSO_PROTOCOLS = ['saml', 'oidc'] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];
export const CONNECTION_STATUSES = ['draft', 'active', 'disabled'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export const DOMAIN_STATUSES = ['pending', 'verified', 'failed'] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];
/** Roles single sign-on and SCIM may give: never `owner` (owners are made in the console only). */
export const SSO_ROLES = [
  'admin',
  'manager',
  'finance',
  'marketing',
  'box_office',
  'scanner',
  'viewer',
] as const;
export type SsoRole = (typeof SSO_ROLES)[number];

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * M6.5a: the org's identity provider (one per org), SAML 2.0 or OpenID Connect. `idp_config`
 * holds the IdP's public settings (entity id, sign-in URL and signing certificate; or issuer and
 * client id); an OIDC client secret is sealed with the key vault and never read back to a page.
 * A connection signs people in only once `active`, and it can be activated only after a test
 * sign-in succeeded with its current settings (`tested_at` ≥ `config_changed_at`).
 */
export const connections = tenantTable(
  ssoSchema,
  'connections',
  {
    protocol: text('protocol').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),
    idpConfig: jsonb('idp_config').notNull().default(sql`'{}'::jsonb`),
    clientSecretSealed: text('client_secret_sealed'),
    defaultRole: text('default_role').notNull().default('viewer'),
    /** Just-in-time provisioning: a first sign-in makes the person a member with `default_role`. */
    jit: boolean('jit').notNull().default(true),
    configChangedAt: ts('config_changed_at').notNull().defaultNow(),
    testedAt: ts('tested_at'),
    lastTestOk: boolean('last_test_ok'),
    lastTestReason: text('last_test_reason'),
    createdBy: uuid('created_by'),
  },
  (t) => [
    uniqueIndex('connections_org_key').on(t.orgId),
    check('connections_protocol_check', inList('protocol', SSO_PROTOCOLS)),
    check('connections_status_check', inList('status', CONNECTION_STATUSES)),
    check('connections_default_role_check', inList('default_role', SSO_ROLES)),
    check('connections_name_check', sql`length(btrim(name)) between 1 and 80`),
    check('connections_test_reason_check', sql`length(last_test_reason) <= 200`),
  ],
);

/**
 * Email domains the org proves it controls with a DNS TXT record (`yayatoh-verification=<token>`
 * at `_yayatoh-sso.<domain>`). Single sign-on only signs in people whose address is in one of the
 * org's verified domains, and only a verified domain can be enforced. A domain is verified by one
 * org platform-wide (DNS is global), so that unique index is deliberately not org-scoped; other
 * orgs may still claim it (pending) and fail to verify.
 */
export const domains = tenantTable(
  ssoSchema,
  'domains',
  {
    domain: text('domain').notNull(),
    status: text('status').notNull().default('pending'),
    token: text('token').notNull(),
    enforced: boolean('enforced').notNull().default(false),
    lastCheckedAt: ts('last_checked_at'),
    verifiedAt: ts('verified_at'),
    failureReason: text('failure_reason'),
  },
  (t) => [
    uniqueIndex('domains_org_domain_key').on(t.orgId, t.domain),
    uniqueIndex('domains_verified_key').on(t.domain).where(sql`status = 'verified'`),
    check('domains_status_check', inList('status', DOMAIN_STATUSES)),
    check('domains_enforced_check', sql`not enforced or status = 'verified'`),
    check(
      'domains_domain_check',
      sql`domain = lower(domain) and length(domain) between 4 and 253 and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'`,
    ),
    check('domains_token_check', sql`length(token) between 32 and 200`),
    check('domains_failure_check', sql`length(failure_reason) <= 200`),
  ],
);

/** A person's identity at the org's IdP (the IdP's stable subject), linked to their account. */
export const identities = tenantTable(
  ssoSchema,
  'identities',
  {
    connectionId: uuid('connection_id').notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id').notNull(),
    lastSignInAt: ts('last_sign_in_at'),
  },
  (t) => [
    uniqueIndex('identities_org_subject_key').on(t.orgId, t.connectionId, t.subject),
    uniqueIndex('identities_org_user_key').on(t.orgId, t.connectionId, t.userId),
    index('identities_org_user_idx').on(t.orgId, t.userId),
    foreignKey({
      name: 'identities_connection_fk',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete('cascade'),
    check('identities_subject_check', sql`length(subject) between 1 and 255`),
  ],
);

/**
 * The org's SCIM bearer token: `yy_scim_` + 32 random bytes, shown once; only its SHA-256 is
 * stored. One live token per org (creating a new one revokes the old: rotation).
 */
export const scimTokens = tenantTable(
  ssoSchema,
  'scim_tokens',
  {
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdBy: uuid('created_by'),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('scim_tokens_hash_key').on(t.tokenHash),
    uniqueIndex('scim_tokens_org_live_key').on(t.orgId).where(sql`revoked_at is null`),
    check('scim_tokens_hash_check', sql`length(token_hash) between 64 and 200`),
    check('scim_tokens_prefix_check', sql`prefix like 'yy_scim_%' and length(prefix) <= 200`),
  ],
);

/**
 * SCIM Users (RFC 7643 §4.1) the org's IdP provisioned. The person is a global account
 * (`user_id`); `active = false` is a deprovisioned user (membership removed, sessions ended).
 */
export const scimUsers = tenantTable(
  ssoSchema,
  'scim_users',
  {
    userId: uuid('user_id').notNull(),
    userName: text('user_name').notNull(),
    /** The account's address (the primary email the IdP sent, else `user_name`). */
    email: text('email').notNull(),
    externalId: text('external_id'),
    displayName: text('display_name'),
    givenName: text('given_name'),
    familyName: text('family_name'),
    active: boolean('active').notNull().default(true),
    deprovisionedAt: ts('deprovisioned_at'),
  },
  (t) => [
    uniqueIndex('scim_users_org_user_key').on(t.orgId, t.userId),
    uniqueIndex('scim_users_org_user_name_key').on(t.orgId, sql`lower(${t.userName})`),
    uniqueIndex('scim_users_org_external_key').on(t.orgId, t.externalId).where(sql`external_id is not null`),
    check('scim_users_user_name_check', sql`length(user_name) between 3 and 320`),
    check('scim_users_email_check', sql`length(email) between 3 and 320`),
    check('scim_users_external_check', sql`external_id is null or length(external_id) between 1 and 255`),
    check(
      'scim_users_names_check',
      sql`coalesce(length(display_name), 0) <= 200 and coalesce(length(given_name), 0) <= 100 and coalesce(length(family_name), 0) <= 100`,
    ),
  ],
);

/** SCIM Groups; `role` maps the group to an org role (set in the console, never by the IdP). */
export const scimGroups = tenantTable(
  ssoSchema,
  'scim_groups',
  {
    displayName: text('display_name').notNull(),
    externalId: text('external_id'),
    role: text('role'),
  },
  (t) => [
    uniqueIndex('scim_groups_org_name_key').on(t.orgId, sql`lower(${t.displayName})`),
    uniqueIndex('scim_groups_org_external_key').on(t.orgId, t.externalId).where(sql`external_id is not null`),
    check('scim_groups_role_check', sql`role is null or ${inList('role', SSO_ROLES)}`),
    check('scim_groups_name_check', sql`length(btrim(display_name)) between 1 and 200`),
    check('scim_groups_external_check', sql`external_id is null or length(external_id) between 1 and 255`),
  ],
);

export const scimGroupMembers = tenantTable(
  ssoSchema,
  'scim_group_members',
  {
    groupId: uuid('group_id').notNull(),
    scimUserId: uuid('scim_user_id').notNull(),
  },
  (t) => [
    uniqueIndex('scim_group_members_org_pair_key').on(t.orgId, t.groupId, t.scimUserId),
    index('scim_group_members_org_user_idx').on(t.orgId, t.scimUserId),
    foreignKey({
      name: 'scim_group_members_group_fk',
      columns: [t.orgId, t.groupId],
      foreignColumns: [scimGroups.orgId, scimGroups.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'scim_group_members_user_fk',
      columns: [t.orgId, t.scimUserId],
      foreignColumns: [scimUsers.orgId, scimUsers.id],
    }).onDelete('cascade'),
  ],
);
