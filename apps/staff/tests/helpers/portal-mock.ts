/** Fake `/v1/portal/*` answers, in the server's shapes (problem+json with `details.reason`). */
import { json, problem } from './fake-door';

export const INVITE = `inv${'A1b2C3d4E5'.repeat(4)}`;
export const inviteLink = `https://app.yayatoh.com/event-portal/invite/${INVITE}`;
export const CHALLENGE = '0192f6f0-0000-7000-8000-0000000ca001';

export function portalPair(n = 1, now = Date.now()) {
  return {
    accessToken: `yyp_access${n}`,
    refreshToken: `yyp_refresh${n}`,
    tokenType: 'bearer',
    expiresIn: 900,
    expiresAt: new Date(now + 900_000).toISOString(),
    refreshExpiresAt: new Date(now + 7 * 86_400_000).toISOString(),
  };
}

export interface Portal {
  code: () => Response;
  token: (body: Record<string, unknown>) => Response;
  /** Access tokens `/v1/portal/leads/setup` accepts. */
  valid: Set<string>;
  requests: { path: string; body: Record<string, unknown>; authorization: string | null }[];
  revoked: string[];
}

export function portal(over: Partial<Portal> = {}): Portal {
  return {
    code: () =>
      json(200, {
        status: 'sent',
        challengeId: CHALLENGE,
        resendAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    token: (body) =>
      body.grantType === 'code'
        ? String(body.code).replace(/\s/g, '') === '123456'
          ? json(200, portalPair())
          : problem(401, 'unauthenticated', { reason: 'wrong_code', attemptsLeft: 4 })
        : problem(401, 'unauthenticated', { reason: 'refresh_token_expired' }),
    valid: new Set(),
    requests: [],
    revoked: [],
    ...over,
  };
}

export async function portalHandler(p: Portal, request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/portal/')) return undefined;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  p.requests.push({ path, body, authorization: request.headers.get('authorization') });
  if (path.endsWith('/portal/auth/code')) return p.code();
  if (path.endsWith('/portal/auth/token')) return p.token(body);
  if (path.endsWith('/portal/auth/revoke')) {
    p.revoked.push(String(body.refreshToken));
    return new Response(null, { status: 204 });
  }
  if (path.endsWith('/portal/leads/setup')) {
    const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    return token && p.valid.has(token)
      ? json(200, { exhibitorName: 'Acme' })
      : problem(401, 'unauthenticated');
  }
  return undefined;
}
