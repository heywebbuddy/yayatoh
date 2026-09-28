import 'server-only';
import { getImpersonation, getUsersByIds, isImpersonationActive, normalizeHandoffHost } from '@yayatoh/auth';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { bareHost, classifyHost, sessionHostAccepted } from '@/lib/hosts.ts';
import { getAuth } from './auth.ts';
import { initialsOf } from './personas.ts';

export { devAuthEnabled } from './dev.ts';

/** Platform staff acting as this member (M1.2e): shown in the banner, carried into every command. */
export interface SessionImpersonation {
  readonly id: string;
  readonly staffUserId: string;
  readonly staffName: string;
  /** The only org whose console this session may open. */
  readonly orgId: string;
  readonly expiresAt: Date;
}

export interface Session {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly initials: string;
  readonly twoFactorEnabled: boolean;
  /**
   * The last re-authentication in this session: the sign-in itself or a later step-up ("Confirm
   * it's you"), whichever is newer. Commands marked `stepUp` need it within 10 minutes.
   */
  readonly stepUpAt: Date;
  readonly impersonation: SessionImpersonation | null;
}

const loadSession = cache(async () => {
  // Read request headers first: it marks the route dynamic before auth is initialised, so builds
  // never need BETTER_AUTH_SECRET.
  const h = await headers();
  const s = await getAuth().api.getSession({ headers: h });
  if (!s) return null;
  // A session works only on the host it was issued for (M1.2d): a cookie copied from another
  // host, or an unbound one on a tenant host, is no session here.
  const raw = h.get('host');
  const bound = (s.session as { host?: string | null }).host ?? null;
  if (!sessionHostAccepted(bound, normalizeHandoffHost(raw), classifyHost(bareHost(raw)))) return null;
  return s;
});

const loadImpersonation = cache(async (id: string): Promise<SessionImpersonation | null> => {
  const imp = await getImpersonation(id);
  if (!imp || !isImpersonationActive(imp, new Date())) return null;
  const staff = (await getUsersByIds([imp.staffUserId])).get(imp.staffUserId);
  return {
    id: imp.id,
    staffUserId: imp.staffUserId,
    staffName: staff?.name ?? '',
    orgId: imp.orgId,
    expiresAt: imp.expiresAt,
  };
});

/**
 * The signed-in user from this host's Better Auth session cookie. The tenant is never taken from
 * the session here; it comes from the route's org param and is checked against membership.
 * A session made for an impersonation that has ended (or whose hour passed) is no session.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const s = await loadSession();
  if (!s) return null;
  const impersonationId = (s.session as { impersonationId?: string | null }).impersonationId ?? null;
  const impersonation = impersonationId ? await loadImpersonation(impersonationId) : null;
  if (impersonationId && !impersonation) return null;
  const created = new Date(s.session.createdAt);
  const steppedUp = s.session.stepUpAt ? new Date(s.session.stepUpAt) : null;
  return {
    userId: s.user.id,
    name: s.user.name,
    email: s.user.email,
    initials: initialsOf(s.user.name),
    twoFactorEnabled: Boolean((s.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled),
    stepUpAt: steppedUp && steppedUp > created ? steppedUp : created,
    impersonation,
  };
});

/**
 * The person's own session: null while staff act as them (M1.2e). Account security (two-step
 * verification, backup codes, signing out everywhere), step-up and tenant sign-in handoffs use
 * this, so an impersonation can never change or extend the person's own access.
 */
export const ownSession = cache(async (): Promise<Session | null> => {
  const s = await getSession();
  return s && !s.impersonation ? s : null;
});

/** Server only: the current session's token (to record a step-up on it). Never sent to a client. */
export async function sessionToken(): Promise<string | null> {
  return (await loadSession())?.session.token ?? null;
}

/**
 * The raw Better Auth session for this host, when it is the person's own (not an impersonation):
 * for pages that need account fields such as `emailVerified` (invitations, signup).
 */
export const ownAuthSession = cache(async () => {
  const s = await loadSession();
  return s && !(s.session as { impersonationId?: string | null }).impersonationId ? s : null;
});

/**
 * Sign out on this host only (M1.2d): its session ends and its cookies go. Other hosts keep
 * theirs. Done directly rather than through Better Auth's sign-out endpoint, whose origin check
 * only knows the app host (a tenant host's form posts from its own origin).
 */
export async function endThisHostSession(): Promise<void> {
  const s = await loadSession();
  const ctx = await getAuth().$context;
  if (s) await ctx.internalAdapter.deleteSession(s.session.token);
  const jar = await cookies();
  for (const c of [
    ctx.authCookies.sessionToken,
    ctx.authCookies.dontRememberToken,
    ctx.authCookies.sessionData,
  ])
    jar.set(c.name, '', {
      path: c.attributes.path ?? '/',
      secure: Boolean(c.attributes.secure),
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 0,
    });
}
