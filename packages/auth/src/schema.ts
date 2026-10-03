import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Identity (Better Auth). Users are global (roadmap §4.1): these tables are listed in
 * GLOBAL_TABLES and are only read or written through packages/auth. Org access lives in
 * tenancy.memberships under RLS.
 */
export const identity = pgSchema('auth');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = identity.table(
  'users',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    /** Preferred language for emails about the orgs they work in (M1.10d); null = English. */
    locale: text('locale'),
    /** Colour theme (ADR 0022): light, dark or system; null = not chosen (light). */
    theme: text('theme'),
    /**
     * Account deleted (M1.14e): the row is kept so audit entries and org records that name this
     * id stay consistent, but it is anonymised (email replaced by a hash at `.invalid`, name
     * cleared); sessions, credentials and two-step verification are gone.
     */
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check(
      'users_locale_check',
      sql`locale is null or locale in ('en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'ar', 'hi', 'ja', 'zh-CN', 'zh-TW')`,
    ),
    check('users_theme_check', sql`theme is null or theme in ('light', 'dark', 'system')`),
  ],
);

export const sessions = identity.table(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    /** Last step-up ("Confirm it's you") in this session; signing in counts too (created_at). */
    stepUpAt: ts('step_up_at'),
    /**
     * The host this session was issued for (M1.2d; with the port outside production). A session is
     * accepted only there: tenant hosts get their own sessions through a handoff code. Null for
     * bearer sessions (API clients) and sessions from before M1.2d.
     */
    host: text('host'),
    /** Set while platform staff act as this person (M1.2e): the impersonation this session belongs to. */
    impersonationId: uuid('impersonation_id').references((): AnyPgColumn => impersonations.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => [
    uniqueIndex('sessions_token_key').on(t.token),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_impersonation_idx').on(t.impersonationId).where(sql`${t.impersonationId} is not null`),
  ],
);

export const accounts = identity.table(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('accounts_user_id_idx').on(t.userId),
    uniqueIndex('accounts_provider_account_key').on(t.providerId, t.accountId),
  ],
);

export const verifications = identity.table(
  'verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const twoFactors = identity.table('two_factors', {
  id: uuid('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  verified: boolean('verified').default(true),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: ts('locked_until'),
  /**
   * The last TOTP time step accepted (M1.2c replay protection): a code for this step or an
   * earlier one is refused, so a code works once even inside its 90-second window.
   */
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
});

/**
 * Security audit for a person (not an org): two-step verification set up or turned off, backup
 * codes used or replaced, sign-in challenges passed and step-ups. Append-only from packages/auth.
 */
export const securityEvents = identity.table(
  'security_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('security_events_user_created_idx').on(t.userId, t.createdAt)],
);

/**
 * Platform staff acting as an org member (M1.2e): who, as whom, in which org, why, and for how
 * long (at most one hour). Written by the staff console through packages/auth; the session made
 * from it carries `impersonation_id`, and ending the impersonation deletes that session.
 */
export const impersonations = identity.table(
  'impersonations',
  {
    id: uuid('id').primaryKey(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * The org the member is acted as in; the session can open only this org's console. Named
     * `target_org_id`, not `org_id`: this global table is not tenant-owned (V11, M2.2c).
     */
    orgId: uuid('target_org_id').notNull(),
    reason: text('reason').notNull(),
    /** Where "End" sends the staff member back to (the staff console's tenant page). */
    returnUrl: text('return_url').notNull(),
    ipAddress: text('ip_address'),
    startedAt: ts('started_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    endedAt: ts('ended_at'),
    /** `ended` (the staff member ended it), `expired` (the hour passed) or `revoked`. */
    endedReason: text('ended_reason'),
  },
  (t) => [
    index('impersonations_target_org_started_idx').on(t.orgId, t.startedAt),
    index('impersonations_staff_idx').on(t.staffUserId, t.startedAt),
    index('impersonations_open_idx').on(t.expiresAt).where(sql`${t.endedAt} is null`),
  ],
);

/**
 * One-time handoff codes (M1.2d): after signing in on the app host, the person is sent to a
 * tenant host with a code that host redeems for its own session. Only a hash is stored; a code is
 * bound to its host and person, works once and lives 60 seconds.
 */
export const handoffCodes = identity.table(
  'handoff_codes',
  {
    id: uuid('id').primaryKey(),
    codeHash: text('code_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The host (with port outside production) that may redeem it. */
    host: text('host').notNull(),
    /** Where to go on that host once signed in (a path, never another origin). */
    returnPath: text('return_path').notNull(),
    /**
     * Hash of the tenant host's sign-in state cookie: the browser that asked to sign in must be
     * the one redeeming (no login CSRF). Null for staff impersonation codes.
     */
    stateHash: text('state_hash'),
    impersonationId: uuid('impersonation_id').references(() => impersonations.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('handoff_codes_code_hash_key').on(t.codeHash),
    index('handoff_codes_user_idx').on(t.userId),
    index('handoff_codes_expires_idx').on(t.expiresAt),
  ],
);

export const LEGACY_TOKEN_KINDS = ['personal_access', 'magic_login', 'password_reset'] as const;

/**
 * Legacy auth artifacts carried over by the migration (M2.2c, roadmap §7.5 T8), per instance.
 * Only hashes are stored: Sanctum's SHA-256 of the personal access token's secret (as the legacy
 * table held it), the SHA-256 of a magic login token (the legacy app stored it in plain text), and
 * the bcrypt hash of a password reset token. A token is live until `expires_at` (null: no expiry)
 * and until it is revoked or used (`revoked_at`; magic links and resets are single-use).
 */
export const legacyTokens = identity.table(
  'legacy_tokens',
  {
    id: uuid('id').primaryKey(),
    instance: text('instance').notNull(),
    kind: text('kind').notNull(),
    legacyId: text('legacy_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    name: text('name'),
    abilities: jsonb('abilities').$type<string[]>(),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('legacy_tokens_instance_kind_legacy_key').on(t.instance, t.kind, t.legacyId),
    uniqueIndex('legacy_tokens_kind_hash_key').on(t.kind, t.tokenHash).where(sql`kind <> 'password_reset'`),
    index('legacy_tokens_user_idx').on(t.userId),
    check('legacy_tokens_instance_check', sql`instance in ('yay', 'abc')`),
    check('legacy_tokens_kind_check', sql`kind in ('personal_access', 'magic_login', 'password_reset')`),
  ],
);

/**
 * Passkeys (M1.2f; Better Auth's passkey plugin, WebAuthn). Staff sign in to the staff console
 * with one (a user-verifying passkey counts as the console's second step). Only the public key is
 * stored; the private key never leaves the authenticator.
 */
export const passkeys = identity.table(
  'passkeys',
  {
    id: uuid('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: ts('created_at').defaultNow(),
  },
  (t) => [
    index('passkeys_user_id_idx').on(t.userId),
    uniqueIndex('passkeys_credential_id_key').on(t.credentialID),
  ],
);

/**
 * Trusted devices (M1.2f): after the second sign-in step, a person may trust the browser for 30
 * days; later sign-ins there skip the second step. The browser holds `<id>.<secret>` in a
 * host-only cookie; only the SHA-256 of the secret is stored. Listed and revocable in account
 * security; all revoked on a password change or reset and on account deletion.
 */
export const trustedDevices = identity.table(
  'trusted_devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    secretHash: text('secret_hash').notNull(),
    /** The host the cookie lives on (with port outside production). */
    host: text('host').notNull(),
    /** A short description from the user agent ("Chrome on macOS"); never the raw header. */
    label: text('label').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    /** `revoked` (by the person), `password_changed`, `account_deleted`. */
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    index('trusted_devices_user_idx').on(t.userId, t.createdAt),
    check(
      'trusted_devices_revoked_reason_check',
      sql`revoked_reason is null or revoked_reason in ('revoked', 'password_changed', 'account_deleted')`,
    ),
  ],
);

/**
 * Rotating refresh tokens for /v1 clients (M1.2f): each use spends the token and issues the next
 * one in the same family with a new short-lived access session. A spent token presented again is
 * a reuse: the whole family is revoked (and its access sessions end). Only SHA-256 is stored.
 */
export const refreshTokens = identity.table(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    familyId: uuid('family_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    /** The Better Auth session (bearer access token) issued with this refresh token. */
    accessSessionToken: text('access_session_token'),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    revokedAt: ts('revoked_at'),
    /** `reuse` (a spent token came back), `signed_out`, `password_changed`. */
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
    check(
      'refresh_tokens_revoked_reason_check',
      sql`revoked_reason is null or revoked_reason in ('reuse', 'signed_out', 'password_changed')`,
    ),
  ],
);

/** Keys match Better Auth model names (drizzle adapter). */
export const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  twoFactor: twoFactors,
  passkey: passkeys,
};
