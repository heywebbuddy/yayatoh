import { createHash, randomBytes } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Auth } from './auth.ts';
import { refreshTokens, securityEvents, sessions } from './schema.ts';

/**
 * Access and refresh tokens for /v1 clients (M1.2f; mobile, CLI). Signing in returns a
 * short-lived access token (a Better Auth bearer session that is never extended) and a refresh
 * token. Each refresh spends the refresh token and returns a new pair in the same **family**; the
 * old access token ends. A refresh token that was already spent and comes back is a **reuse**
 * (it was copied, or the client was cloned): the whole family is revoked and its access tokens
 * end, so both the thief and the victim must sign in again. Only SHA-256 hashes are stored.
 */
export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

const PREFIX = 'yyr_';
const SHAPE = /^yyr_[A-Za-z0-9_-]{43}$/;

/** A new refresh token: `yyr_` + 256 random bits (base64url). */
export const newRefreshToken = (): string => `${PREFIX}${randomBytes(32).toString('base64url')}`;

/** The shape of a refresh token (anything else is refused without a lookup). */
export const isRefreshToken = (value: string): boolean => SHAPE.test(value);

/** Refresh tokens are stored as SHA-256 hex; the token itself never is. */
export const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface TokenPair {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

export type RefreshRefusal = 'invalid' | 'expired' | 'revoked' | 'reused';

export type RefreshResult =
  | { readonly ok: true; readonly tokens: TokenPair }
  | { readonly ok: false; readonly reason: RefreshRefusal };

async function audit(userId: string, action: string, data: Record<string, unknown>, now: Date) {
  await identityDatabase()
    .insert(securityEvents)
    .values({ id: uuidv7(), userId, action, data, createdAt: now });
}

/** End access sessions by token (the family's, on reuse or sign-out). */
async function endAccessSessions(tokens: readonly (string | null)[]) {
  const live = tokens.filter((t): t is string => Boolean(t));
  if (live.length > 0) await identityDatabase().delete(sessions).where(inArray(sessions.token, live));
}

export function refreshTokenService(auth: Auth, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());

  async function issueIn(familyId: string, userId: string, at: Date): Promise<TokenPair | null> {
    const c = await auth.$context;
    const user = await c.internalAdapter.findUserById(userId);
    if (!user || (user as { deletedAt?: Date | null }).deletedAt) return null;
    const accessTokenExpiresAt = new Date(at.getTime() + ACCESS_TOKEN_TTL_MS);
    // Not "remembered" and bound to no host: a bearer session for API clients only.
    const session = await c.internalAdapter.createSession(
      userId,
      true,
      { expiresAt: accessTokenExpiresAt, host: null },
      true,
    );
    const refreshToken = newRefreshToken();
    const refreshTokenExpiresAt = new Date(at.getTime() + REFRESH_TOKEN_TTL_MS);
    await identityDatabase()
      .insert(refreshTokens)
      .values({
        id: uuidv7(),
        familyId,
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        accessSessionToken: session.token,
        createdAt: at,
        expiresAt: refreshTokenExpiresAt,
      });
    return {
      accessToken: session.token,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  async function revokeFamily(familyId: string, reason: 'reuse' | 'signed_out', at: Date) {
    const rows = await identityDatabase()
      .update(refreshTokens)
      .set({ revokedAt: at, revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
      .returning({ access: refreshTokens.accessSessionToken });
    const all = await identityDatabase()
      .select({ access: refreshTokens.accessSessionToken })
      .from(refreshTokens)
      .where(eq(refreshTokens.familyId, familyId));
    await endAccessSessions([...rows, ...all].map((r) => r.access));
  }

  return {
    /** A new family for a person who just signed in (password checked by the caller). */
    async issue(userId: string): Promise<TokenPair> {
      const at = now();
      const pair = await issueIn(uuidv7(), userId, at);
      if (!pair) throw new Error('refreshTokenService.issue: no such user');
      await audit(userId, 'refresh_token.issued', {}, at);
      return pair;
    },

    /**
     * Spend a refresh token for a new pair. The update is the check: of two requests with the same
     * token exactly one wins; the other (and any later one) is a reuse and revokes the family.
     */
    async rotate(token: string): Promise<RefreshResult> {
      if (!isRefreshToken(token)) return { ok: false, reason: 'invalid' };
      const at = now();
      const hash = hashRefreshToken(token);
      const db = identityDatabase();
      const [spent] = await db
        .update(refreshTokens)
        .set({ usedAt: at })
        .where(
          and(
            eq(refreshTokens.tokenHash, hash),
            isNull(refreshTokens.usedAt),
            isNull(refreshTokens.revokedAt),
          ),
        )
        .returning();
      if (!spent) {
        const [seen] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash));
        if (!seen) return { ok: false, reason: 'invalid' };
        if (seen.usedAt && !seen.revokedAt) {
          await revokeFamily(seen.familyId, 'reuse', at);
          await audit(seen.userId, 'refresh_token.reuse_detected', { family: seen.familyId }, at);
          return { ok: false, reason: 'reused' };
        }
        if (seen.revokedReason === 'reuse') {
          await audit(seen.userId, 'refresh_token.reuse_detected', { family: seen.familyId }, at);
          return { ok: false, reason: 'reused' };
        }
        return { ok: false, reason: 'revoked' };
      }
      // The access token issued with the spent refresh token ends now.
      await endAccessSessions([spent.accessSessionToken]);
      if (spent.expiresAt.getTime() <= at.getTime()) return { ok: false, reason: 'expired' };
      const pair = await issueIn(spent.familyId, spent.userId, at);
      if (!pair) return { ok: false, reason: 'revoked' };
      return { ok: true, tokens: pair };
    },

    /** Sign out: the token's family is revoked and its access tokens end (unknown tokens: no-op). */
    async revoke(token: string): Promise<void> {
      if (!isRefreshToken(token)) return;
      const [row] = await identityDatabase()
        .select({ familyId: refreshTokens.familyId, userId: refreshTokens.userId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));
      if (!row) return;
      const at = now();
      await revokeFamily(row.familyId, 'signed_out', at);
      await audit(row.userId, 'refresh_token.revoked', { family: row.familyId }, at);
    },
  };
}

export type RefreshTokenService = ReturnType<typeof refreshTokenService>;

/** Whether a bearer token is an access token issued with a refresh token (never extended). */
export async function isAccessToken(sessionToken: string): Promise<boolean> {
  const [row] = await identityDatabase()
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(
      and(eq(refreshTokens.accessSessionToken, sessionToken), isNotNull(refreshTokens.accessSessionToken)),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * A password change or reset: every refresh-token family of the person is revoked and their
 * access tokens end (the web's sessions are handled by Better Auth).
 */
export async function revokeAllRefreshTokens(userId: string, at: Date = new Date()): Promise<number> {
  const rows = await identityDatabase()
    .update(refreshTokens)
    .set({ revokedAt: at, revokedReason: 'password_changed' })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ access: refreshTokens.accessSessionToken });
  await endAccessSessions(rows.map((r) => r.access));
  return rows.length;
}
