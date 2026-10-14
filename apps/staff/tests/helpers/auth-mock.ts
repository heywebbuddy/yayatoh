/** Fake `/v1/auth/*` and `/v1/portal/auth/*` answers, in the server's problem+json shape. */
import { json, problem } from './fake-door';

export const USER = {
  id: '0192f6f0-0000-7000-8000-0000000000a1',
  email: 'omar@yayatoh.test',
  name: 'Omar',
  emailVerified: true,
};

export function tokenPair(n = 1, now = Date.now()) {
  return {
    accessToken: `access-${n}`,
    tokenType: 'bearer',
    accessTokenExpiresAt: new Date(now + 15 * 60_000).toISOString(),
    refreshToken: `refresh-${n}`,
    refreshTokenExpiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    user: USER,
  };
}

export const twoFactorRequired = (challenge = 'challenge-1') =>
  problem(401, 'step_up_required', {
    reason: 'two_factor_required',
    challenge,
    challengeExpiresAt: new Date(Date.now() + 300_000).toISOString(),
  });

export interface Auth {
  /** Password sign-in: what the server answers. */
  password: () => Response;
  /** The two-factor step: what the server answers. */
  twoFactor: (code: string) => Response;
  requests: { path: string; body: Record<string, unknown> }[];
  revoked: string[];
}

export function auth(over: Partial<Auth> = {}): Auth {
  const a: Auth = {
    password: () => twoFactorRequired(),
    twoFactor: (code) =>
      code === '123456'
        ? json(200, tokenPair())
        : problem(400, 'validation_failed', { reason: 'invalid_code' }),
    requests: [],
    revoked: [],
    ...over,
  };
  return a;
}

export async function authHandler(a: Auth, request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/auth/')) return undefined;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  a.requests.push({ path, body });
  if (path.endsWith('/auth/revoke')) {
    a.revoked.push(String(body.refreshToken));
    return new Response(null, { status: 204 });
  }
  if (path.endsWith('/auth/token')) {
    if (body.grantType === 'password') return a.password();
    if (body.grantType === 'two_factor') return a.twoFactor(String(body.code));
  }
  return undefined;
}
