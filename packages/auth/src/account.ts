import { createHash } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  accounts,
  passkeys,
  refreshTokens,
  securityEvents,
  sessions,
  trustedDevices,
  twoFactors,
  users,
  verifications,
} from './schema.ts';

/**
 * A person's own account as data (M1.14e, Yayatoh as controller): what we hold, allowlisted for
 * their access request, and the erasure that anonymises the account. Identity tables are only
 * read or written here (packages/auth), never by modules.
 */

const norm = (email: string) => email.normalize('NFC').trim().toLowerCase();
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Where an anonymised account's email points: a hash at `.invalid` (RFC 2606), never deliverable. */
export const DELETED_EMAIL_DOMAIN = 'erased.invalid';

export interface AccountUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly locale: string | null;
  readonly twoFactorEnabled: boolean;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

const userCols = {
  id: users.id,
  name: users.name,
  email: users.email,
  emailVerified: users.emailVerified,
  locale: users.locale,
  twoFactorEnabled: users.twoFactorEnabled,
  createdAt: users.createdAt,
  deletedAt: users.deletedAt,
};

const toUser = (r: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  locale: string | null;
  twoFactorEnabled: boolean | null;
  createdAt: Date;
  deletedAt: Date | null;
}): AccountUser => ({ ...r, twoFactorEnabled: Boolean(r.twoFactorEnabled) });

/** The live (not deleted) account for an email, if any (case-insensitive). */
export async function findUserByEmail(email: string): Promise<AccountUser | null> {
  const [row] = await identityDatabase()
    .select(userCols)
    .from(users)
    .where(and(sql`lower(${users.email}) = ${norm(email)}`, isNull(users.deletedAt)));
  return row ? toUser(row) : null;
}

export async function findUserById(userId: string): Promise<AccountUser | null> {
  const [row] = await identityDatabase().select(userCols).from(users).where(eq(users.id, userId));
  return row ? toUser(row) : null;
}

/** Security-event details that may leave: how a step was taken, never codes or secrets. */
const EVENT_DATA_KEYS = ['method', 'purpose', 'by'] as const;

/**
 * Everything the identity store holds about the person, allowlisted: profile, sessions (device and
 * times, never tokens), how they sign in (never password hashes or secrets), two-step
 * verification status (never the seed or backup codes) and their security events.
 */
export async function accountIdentityData(userId: string, currentSessionToken?: string | null) {
  const db = identityDatabase();
  const user = await findUserById(userId);
  if (!user || user.deletedAt) return null;
  const sessionRows = await db
    .select({
      token: sessions.token,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      expiresAt: sessions.expiresAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt));
  const methodRows = await db
    .select({ providerId: accounts.providerId, password: accounts.password, createdAt: accounts.createdAt })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.createdAt));
  const events = await db
    .select({ action: securityEvents.action, data: securityEvents.data, createdAt: securityEvents.createdAt })
    .from(securityEvents)
    .where(eq(securityEvents.userId, userId))
    .orderBy(asc(securityEvents.createdAt), asc(securityEvents.id))
    .limit(1000);
  return {
    profile: {
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      emailLanguage: user.locale,
      createdAt: user.createdAt,
    },
    signIn: {
      password: methodRows.some((m) => m.providerId === 'credential' && Boolean(m.password)),
      emailCodes: true,
      twoStepVerification: user.twoFactorEnabled,
      providers: [...new Set(methodRows.map((m) => m.providerId))],
    },
    sessions: sessionRows.map((s) => ({
      current: currentSessionToken ? s.token === currentSessionToken : false,
      signedInAt: s.createdAt,
      lastActiveAt: s.updatedAt,
      expiresAt: s.expiresAt,
      ipAddress: s.ipAddress,
      device: s.userAgent,
    })),
    securityEvents: events.map((e) => ({
      action: e.action,
      details: Object.fromEntries(
        EVENT_DATA_KEYS.filter((k) => typeof (e.data as Record<string, unknown>)[k] === 'string').map((k) => [
          k,
          (e.data as Record<string, unknown>)[k] as string,
        ]),
      ),
      at: e.createdAt,
    })),
  };
}

export type AccountIdentityData = NonNullable<Awaited<ReturnType<typeof accountIdentityData>>>;

/** Append a security event for a person (e.g. `account.exported`). */
export async function recordAccountEvent(
  userId: string,
  action: 'account.exported' | 'account.deleted',
  data: Record<string, string> = {},
): Promise<void> {
  await identityDatabase().insert(securityEvents).values({ id: uuidv7(), userId, action, data });
}

export interface IdentityErasure {
  readonly sessions: number;
  readonly credentials: number;
  readonly twoFactor: number;
  readonly verifications: number;
}

/**
 * Anonymise an account (the person asked to delete it). In one transaction: a security event
 * `account.deleted` is written first (kept, under the pseudonymous id); every session is revoked;
 * credentials, two-step verification, passkeys, refresh tokens and pending codes are deleted and
 * trusted devices revoked; the row keeps its id (audit
 * entries and org records that name it stay consistent) but its email becomes a hash at
 * `.invalid` and the name, picture and language are cleared. The same address can sign up again
 * as a new account.
 */
export async function anonymiseAccount(
  userId: string,
  opts: { by: 'self' | 'staff'; now?: Date },
): Promise<IdentityErasure> {
  const now = opts.now ?? new Date();
  return identityDatabase().transaction(async (tx) => {
    const [u] = await tx
      .select({ email: users.email, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!u) throw new Error('anonymiseAccount: no such user');
    if (u.deletedAt) return { sessions: 0, credentials: 0, twoFactor: 0, verifications: 0 };
    const email = norm(u.email);
    await tx
      .insert(securityEvents)
      .values({ id: uuidv7(), userId, action: 'account.deleted', data: { by: opts.by }, createdAt: now });
    const s = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    const c = await tx.delete(accounts).where(eq(accounts.userId, userId)).returning({ id: accounts.id });
    // M1.2f: trusted devices are revoked (kept for the audit trail), passkeys and /v1 refresh
    // tokens are gone.
    await tx
      .update(trustedDevices)
      .set({ revokedAt: now, revokedReason: 'account_deleted' })
      .where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)));
    await tx.delete(passkeys).where(eq(passkeys.userId, userId));
    await tx.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    const t = await tx
      .delete(twoFactors)
      .where(eq(twoFactors.userId, userId))
      .returning({ id: twoFactors.id });
    const v = await tx
      .delete(verifications)
      .where(
        or(
          ilike(verifications.identifier, `%${likeEscape(email)}%`),
          ilike(verifications.identifier, `%${userId}%`),
          eq(verifications.value, userId),
          ilike(verifications.value, `%${likeEscape(email)}%`),
        ),
      )
      .returning({ id: verifications.id });
    await tx
      .update(users)
      .set({
        email: `${sha256(email)}+${userId}@${DELETED_EMAIL_DOMAIN}`,
        name: '',
        image: null,
        locale: null,
        emailVerified: false,
        twoFactorEnabled: false,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
    return { sessions: s.length, credentials: c.length, twoFactor: t.length, verifications: v.length };
  });
}
