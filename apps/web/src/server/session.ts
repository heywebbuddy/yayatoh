import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { getAuth } from './auth.ts';
import { initialsOf } from './personas.ts';

export { devAuthEnabled } from './dev.ts';

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
}

const loadSession = cache(async () => {
  // Read request headers first: it marks the route dynamic before auth is initialised, so builds
  // never need BETTER_AUTH_SECRET.
  const h = await headers();
  return getAuth().api.getSession({ headers: h });
});

/**
 * The signed-in user from this host's Better Auth session cookie. The tenant is never taken from
 * the session here; it comes from the route's org param and is checked against membership.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const s = await loadSession();
  if (!s) return null;
  const created = new Date(s.session.createdAt);
  const steppedUp = s.session.stepUpAt ? new Date(s.session.stepUpAt) : null;
  return {
    userId: s.user.id,
    name: s.user.name,
    email: s.user.email,
    initials: initialsOf(s.user.name),
    twoFactorEnabled: Boolean((s.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled),
    stepUpAt: steppedUp && steppedUp > created ? steppedUp : created,
  };
});

/** Server only: the current session's token (to record a step-up on it). Never sent to a client. */
export async function sessionToken(): Promise<string | null> {
  return (await loadSession())?.session.token ?? null;
}
