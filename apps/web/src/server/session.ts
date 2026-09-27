import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { getAuth } from './auth.ts';
import { initialsOf } from './personas.ts';

/** The persona shortcut (/dev/login) is on only when explicitly enabled and never in production. */
export function devAuthEnabled(): boolean {
  return process.env.YAYATOH_DEV_AUTH === '1' && process.env.VERCEL_ENV !== 'production';
}

export interface Session {
  readonly userId: string;
  readonly name: string;
  readonly initials: string;
}

/**
 * The signed-in user from this host's Better Auth session cookie. The tenant is never taken from
 * the session here; it comes from the route's org param and is checked against membership.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  // Read request headers first: it marks the route dynamic before auth is initialised, so builds
  // never need BETTER_AUTH_SECRET.
  const h = await headers();
  const s = await getAuth().api.getSession({ headers: h });
  if (!s) return null;
  return { userId: s.user.id, name: s.user.name, initials: initialsOf(s.user.name) };
});
