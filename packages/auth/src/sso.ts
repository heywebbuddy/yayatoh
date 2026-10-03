import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Auth } from './auth.ts';
import { revokeAllRefreshTokens } from './refresh-tokens.ts';
import { accounts, securityEvents, sessions, trustedDevices, twoFactors, users } from './schema.ts';

/**
 * Single sign-on and SCIM, the identity side (M6.5a). The org side (connections, verified domains,
 * identity links, SCIM resources, memberships) lives in `@yayatoh/sso` under the org's RLS; this
 * file only reads and writes global accounts and sessions.
 *
 * Rules:
 *  - an SSO sign-in or a SCIM user may only name an address in a domain the org verified (the
 *    caller checks it before anything here runs); such an address's account is the person's;
 *  - a session made by single sign-on carries `sso_org_id` and opens that org's console only;
 *  - people with two-step verification, and **every** platform staff member, still answer the
 *    authenticator code after the IdP (SSO never replaces it); staff without it are refused;
 *  - a deprovisioned person's sessions, /v1 refresh tokens and their access tokens end at once.
 */

const norm = (email: string) => email.normalize('NFC').trim().toLowerCase();

async function audit(userId: string, action: string, data: Record<string, unknown>) {
  await identityDatabase().insert(securityEvents).values({ id: uuidv7(), userId, action, data });
}

/** Active platform staff (`platform.is_staff`, a SECURITY DEFINER function returning one boolean). */
export async function isPlatformStaff(userId: string): Promise<boolean> {
  const rows = await identityDatabase().execute<{ staff: boolean }>(
    sql`select platform.is_staff(${userId}::uuid) as staff`,
  );
  return rows[0]?.staff === true;
}

export interface SsoAccount {
  readonly userId: string;
  readonly created: boolean;
}

/**
 * The account for an address the org's IdP (or SCIM client) vouches for: the live account with
 * that email, else a new one (email verified: the org proved it controls the domain). Deleted
 * accounts are never reused.
 */
export async function findOrCreateSsoAccount(
  auth: Auth,
  input: { email: string; name: string | null; via: 'sso' | 'scim'; protocol?: 'saml' | 'oidc' },
): Promise<SsoAccount> {
  const email = norm(input.email);
  const db = identityDatabase();
  const [existing] = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)));
  if (existing) {
    // Pre-hijack guard (as for Google/Apple, M1.2f): whoever made an account for this address
    // without ever verifying it may not own it. Its password, two-step verification, trusted
    // devices and sessions go; the org's IdP is now how the address signs in.
    if (!existing.emailVerified) {
      await db.transaction(async (tx) => {
        await tx
          .delete(accounts)
          .where(and(eq(accounts.userId, existing.id), eq(accounts.providerId, 'credential')));
        await tx.delete(twoFactors).where(eq(twoFactors.userId, existing.id));
        await tx.delete(sessions).where(eq(sessions.userId, existing.id));
        await tx
          .update(trustedDevices)
          .set({ revokedAt: new Date(), revokedReason: 'password_changed' })
          .where(and(eq(trustedDevices.userId, existing.id), isNull(trustedDevices.revokedAt)));
        await tx
          .update(users)
          .set({ emailVerified: true, twoFactorEnabled: false, updatedAt: new Date() })
          .where(eq(users.id, existing.id));
      });
      await audit(existing.id, `${input.via}.account_reset`, {});
    }
    return { userId: existing.id, created: false };
  }
  const c = await auth.$context;
  const name = input.name?.trim().slice(0, 200) || email.split('@')[0] || email;
  try {
    const user = await c.internalAdapter.createUser(
      { email, name, emailVerified: true },
      input.via === 'scim'
        ? { method: 'scim' }
        : { method: input.protocol === 'oidc' ? 'sso-oidc' : 'sso-saml', sso: { providerId: 'yayatoh-sso' } },
    );
    await audit(user.id, `${input.via}.account_created`, {});
    return { userId: user.id, created: true };
  } catch (err) {
    // Two first sign-ins at once: the other one made it.
    const [again] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)));
    if (again) return { userId: again.id, created: false };
    throw err;
  }
}

/**
 * End everything that keeps a person signed in (SCIM deprovisioning): every session on every host,
 * /v1 refresh tokens and their access tokens. Their next request has no session.
 */
export async function revokeAllSessions(userId: string, reason: 'scim_deprovisioned'): Promise<number> {
  const ended = await identityDatabase()
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  await revokeAllRefreshTokens(userId);
  await audit(userId, 'sessions.revoked', { by: reason });
  return ended.length;
}

/** The org a session was made for by single sign-on, or null (server only). */
export async function sessionSsoOrg(token: string): Promise<string | null> {
  const [row] = await identityDatabase()
    .select({ orgId: sessions.ssoOrgId })
    .from(sessions)
    .where(eq(sessions.token, token));
  return row?.orgId ?? null;
}
