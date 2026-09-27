import type { Auth } from './auth.ts';

export interface BearerSession {
  /** The Better Auth session token, sent back as `Authorization: Bearer …`. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

export type SignInResult =
  | { readonly ok: true; readonly session: BearerSession }
  | { readonly ok: false; readonly reason: 'invalid_credentials' | 'two_factor_required' };

/**
 * Bearer sessions for API clients (mobile, CLI): the same Better Auth sessions as the web, carried
 * in the Authorization header instead of a cookie (the bearer plugin). No cookie is ever set.
 */
export interface BearerSessions {
  signIn(email: string, password: string): Promise<SignInResult>;
  /** The live session for a token, sliding its expiry like a cookie session; null if unknown. */
  session(token: string): Promise<BearerSession | null>;
  signOut(token: string): Promise<void>;
}

const bearerHeaders = (token: string) => new Headers({ authorization: `Bearer ${token}` });

export function bearerSessions(auth: Auth): BearerSessions {
  const session = async (token: string): Promise<BearerSession | null> => {
    if (!/^[A-Za-z0-9._%-]{16,300}$/.test(token)) return null;
    const s = await auth.api.getSession({ headers: bearerHeaders(token) });
    if (!s) return null;
    return {
      token: s.session.token,
      expiresAt: new Date(s.session.expiresAt),
      user: { id: s.user.id, name: s.user.name, email: s.user.email },
    };
  };
  return {
    async signIn(email, password) {
      let res: Awaited<ReturnType<typeof auth.api.signInEmail>>;
      try {
        res = await auth.api.signInEmail({ body: { email, password } });
      } catch {
        return { ok: false, reason: 'invalid_credentials' };
      }
      if ('twoFactorRedirect' in res && res.twoFactorRedirect)
        return { ok: false, reason: 'two_factor_required' };
      const token = 'token' in res ? res.token : null;
      const s = token ? await session(token) : null;
      return s ? { ok: true, session: s } : { ok: false, reason: 'invalid_credentials' };
    },
    session,
    async signOut(token) {
      try {
        await auth.api.signOut({ headers: bearerHeaders(token) });
      } catch {
        // Unknown or already-ended sessions are simply gone.
      }
    },
  };
}
