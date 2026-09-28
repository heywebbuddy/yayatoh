import { sql } from 'drizzle-orm';
import {
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
  },
  (t) => [uniqueIndex('sessions_token_key').on(t.token), index('sessions_user_id_idx').on(t.userId)],
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

/** Keys match Better Auth model names (drizzle adapter). */
export const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  twoFactor: twoFactors,
};
