import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { PORTAL_ROLES, PORTAL_SUBJECT_KINDS } from './domain/portal-auth.ts';
import { eventRoleAssignments, events, eventsSchema } from './schema.ts';

/**
 * M5.3a portal accounts (P5-7): a speaker, exhibitor admin or staff, or sponsor contact of one
 * event. Not an org member and not a Better Auth user: the account is its own identity, bound to
 * exactly one event-role assignment (`assignment_id`; the assignment's `user_id` is the account
 * id) and one program row (`subject_kind`, `subject_id`). Codes, links and sessions are stored as
 * HMACs only. Everything is tenant data under the org's row-level security; the org of a request
 * comes from the signed invitation or session token, never from a header.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const portalAccounts = tenantTable(
  eventsSchema,
  'portal_accounts',
  {
    eventId: uuid('event_id').notNull(),
    assignmentId: uuid('assignment_id').notNull(),
    role: text('role').notNull(),
    subjectKind: text('subject_kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    email: text('email').notNull(),
    /** Bumped when the organizer reissues the invitation: older links stop working. */
    inviteVersion: integer('invite_version').notNull().default(1),
    invitedAt: ts('invited_at').notNull(),
    revokedAt: ts('revoked_at'),
    lastSignInAt: ts('last_sign_in_at'),
  },
  (t) => [
    uniqueIndex('portal_accounts_org_event_role_subject_email_key').on(
      t.orgId,
      t.eventId,
      t.role,
      t.subjectId,
      t.email,
    ),
    uniqueIndex('portal_accounts_org_assignment_key').on(t.orgId, t.assignmentId),
    index('portal_accounts_org_event_subject_idx').on(t.orgId, t.eventId, t.subjectKind, t.subjectId),
    foreignKey({
      name: 'portal_accounts_event_fk',
      columns: [t.orgId, t.eventId],
      foreignColumns: [events.orgId, events.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'portal_accounts_assignment_fk',
      columns: [t.orgId, t.assignmentId],
      foreignColumns: [eventRoleAssignments.orgId, eventRoleAssignments.id],
    }).onDelete('cascade'),
    check('portal_accounts_role_check', inList('role', PORTAL_ROLES)),
    check('portal_accounts_subject_kind_check', inList('subject_kind', PORTAL_SUBJECT_KINDS)),
    check('portal_accounts_email_check', sql`email = lower(email) and char_length(email) between 3 and 254`),
    check('portal_accounts_invite_version_check', sql`invite_version between 1 and 999999`),
  ],
);

/** A sign-in code (and magic link) for one portal account: M1.5f rules. */
export const portalChallenges = tenantTable(
  eventsSchema,
  'portal_challenges',
  {
    accountId: uuid('account_id').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    linkHash: text('link_hash'),
    browserHash: text('browser_hash'),
    linkExpiresAt: ts('link_expires_at'),
    usedAt: ts('used_at'),
  },
  (t) => [
    index('portal_challenges_org_account_idx').on(t.orgId, t.accountId, t.createdAt),
    foreignKey({
      name: 'portal_challenges_account_fk',
      columns: [t.orgId, t.accountId],
      foreignColumns: [portalAccounts.orgId, portalAccounts.id],
    }).onDelete('cascade'),
    check('portal_challenges_attempts_check', sql`attempts between 0 and 5`),
    check(
      'portal_challenges_link_check',
      sql`(link_hash is null) = (link_expires_at is null) and (link_hash is null or browser_hash is not null)`,
    ),
  ],
);

/** A signed-in portal browser. The cookie is `{org}~{secret}`; only the secret's HMAC is stored. */
export const portalSessions = tenantTable(
  eventsSchema,
  'portal_sessions',
  {
    accountId: uuid('account_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    host: text('host').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('portal_sessions_org_token_key').on(t.orgId, t.tokenHash),
    index('portal_sessions_org_account_idx').on(t.orgId, t.accountId),
    foreignKey({
      name: 'portal_sessions_account_fk',
      columns: [t.orgId, t.accountId],
      foreignColumns: [portalAccounts.orgId, portalAccounts.id],
    }).onDelete('cascade'),
  ],
);
