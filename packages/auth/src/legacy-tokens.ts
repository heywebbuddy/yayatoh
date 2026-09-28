import { createHash } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { parseSanctumToken } from './compat/sanctum.ts';
import { legacyTokens } from './schema.ts';

/**
 * Legacy auth artifacts carried by the migration (T8, `auth.legacy_tokens`). The `/api/v2` facade
 * and the legacy `/magic-login/{token}` link resolve through these; they never return the hash.
 */
export interface LegacyTokenIdentity {
  readonly userId: string;
  readonly instance: 'yay' | 'abc';
  readonly abilities: readonly string[];
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const live = (now: Date) =>
  and(isNull(legacyTokens.revokedAt), or(isNull(legacyTokens.expiresAt), gt(legacyTokens.expiresAt, now)));

/**
 * A legacy Sanctum bearer (`{id}|{secret}`): the user when the token was carried, is unexpired and
 * not revoked. Stamps `last_used_at` at most once a minute.
 */
export async function verifyLegacyAccessToken(
  bearer: string,
  now = new Date(),
): Promise<LegacyTokenIdentity | null> {
  const parsed = parseSanctumToken(bearer.trim());
  if (!parsed) return null;
  const db = identityDatabase();
  const [row] = await db
    .select()
    .from(legacyTokens)
    .where(
      and(
        eq(legacyTokens.kind, 'personal_access'),
        eq(legacyTokens.tokenHash, sha256(parsed.secret)),
        eq(legacyTokens.legacyId, String(parsed.id)),
        live(now),
      ),
    );
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000)
    await db.update(legacyTokens).set({ lastUsedAt: now }).where(eq(legacyTokens.id, row.id));
  return { userId: row.userId, instance: row.instance as 'yay' | 'abc', abilities: row.abilities ?? [] };
}

/**
 * A legacy magic login link's token: the user, once. The link is single-use (as in the legacy app),
 * so a second use, an expired or an unknown token returns null.
 */
export async function consumeLegacyMagicLink(
  token: string,
  now = new Date(),
): Promise<LegacyTokenIdentity | null> {
  const t = token.trim();
  if (!/^[0-9a-f]{32,128}$/i.test(t)) return null;
  const [row] = await identityDatabase()
    .update(legacyTokens)
    .set({ revokedAt: now })
    .where(and(eq(legacyTokens.kind, 'magic_login'), eq(legacyTokens.tokenHash, sha256(t)), live(now)))
    .returning();
  return row ? { userId: row.userId, instance: row.instance as 'yay' | 'abc', abilities: [] } : null;
}

/** Revoke every legacy token of a person (password change, account erasure, "sign out everywhere"). */
export async function revokeLegacyTokens(userId: string, now = new Date()): Promise<number> {
  const rows = await identityDatabase()
    .update(legacyTokens)
    .set({ revokedAt: now })
    .where(and(eq(legacyTokens.userId, userId), isNull(legacyTokens.revokedAt)))
    .returning({ id: legacyTokens.id });
  return rows.length;
}

/** Counts per kind of a person's live legacy tokens (account security page). */
export async function legacyTokenCounts(userId: string, now = new Date()) {
  return identityDatabase()
    .select({ kind: legacyTokens.kind, n: sql<number>`count(*)::int` })
    .from(legacyTokens)
    .where(and(eq(legacyTokens.userId, userId), live(now)))
    .groupBy(legacyTokens.kind);
}
