import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { type Persona, personaById } from './personas.ts';

export const DEV_SESSION_COOKIE = 'yy_dev_user';

/** Dev/preview sign-in is on only when explicitly enabled and never in production. */
export function devAuthEnabled(): boolean {
  return process.env.YAYATOH_DEV_AUTH === '1' && process.env.VERCEL_ENV !== 'production';
}

export interface Session {
  readonly userId: string;
  readonly name: string;
  readonly initials: string;
}

/**
 * The signed-in user. Until Better Auth lands (M1.2) this reads the dev persona cookie.
 * The tenant is never taken from the session here; it comes from the route's org param and is
 * then checked against the user's membership.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!devAuthEnabled()) return null;
  const id = (await cookies()).get(DEV_SESSION_COOKIE)?.value;
  const persona: Persona | undefined = id ? personaById(id) : undefined;
  return persona ? { userId: persona.userId, name: persona.name, initials: persona.initials } : null;
});
