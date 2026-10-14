/**
 * A fake `/v1` for the client and session tests: a `fetch` that answers the token routes and a few
 * protected ones the way the real server does (problem+json, `details.reason`), and records calls.
 */
import type { Schemas } from '@yayatoh/sdk';

export const USER: Schemas['User'] = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ada@example.test',
  emailVerified: true,
  name: 'Ada',
};

export const problem = (status: number, code: string, details: Record<string, unknown> = {}, headers = {}) =>
  new Response(JSON.stringify({ type: `https://x/${code}`, title: code, status, code, details }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });

export const json = (status: number, body: unknown, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function pair(n: number, now = Date.now(), ttlMs = 15 * 60_000): Schemas['TokenPair'] {
  return {
    accessToken: `access-${n}`,
    tokenType: 'bearer',
    accessTokenExpiresAt: new Date(now + ttlMs).toISOString(),
    refreshToken: `refresh-${n}`,
    refreshTokenExpiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    user: USER,
  };
}

export interface FakeApi {
  fetch: typeof globalThis.fetch;
  calls: {
    method: string;
    path: string;
    fullPath: string;
    authorization: string | null;
    client: string | null;
    body: unknown;
  }[];
  /** Access tokens the server accepts. */
  valid: Set<string>;
  /** The refresh token the server expects next; anything else is a reuse. */
  expectedRefresh: string;
  generation: number;
  refreshes(): number;
  /** Make the next refresh fail with this response. */
  failRefreshWith?: () => Response | Promise<Response>;
  delayRefreshMs: number;
}

export function createFakeApi(now: () => number = Date.now): FakeApi {
  const api: FakeApi = {
    calls: [],
    valid: new Set(['access-0']),
    expectedRefresh: 'refresh-0',
    generation: 0,
    delayRefreshMs: 0,
    refreshes: () =>
      api.calls.filter(
        (c) =>
          c.path === '/v1/auth/token' && (c.body as { grantType?: string })?.grantType === 'refresh_token',
      ).length,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const fullPath = url.pathname;
      url.pathname = url.pathname.replace(/^.*?(\/v1\/)/, '/v1/');
      const raw = request.method === 'GET' ? '' : await request.clone().text();
      const body = raw ? JSON.parse(raw) : undefined;
      const authorization = request.headers.get('authorization');
      api.calls.push({
        method: request.method,
        path: url.pathname,
        fullPath,
        authorization,
        client: request.headers.get('x-yayatoh-client'),
        body,
      });
      if (url.pathname === '/v1/auth/token' && body?.grantType === 'refresh_token') {
        if (api.delayRefreshMs) await new Promise((r) => setTimeout(r, api.delayRefreshMs));
        if (api.failRefreshWith) return api.failRefreshWith();
        if (body.refreshToken !== api.expectedRefresh)
          return problem(401, 'unauthenticated', { reason: 'refresh_token_reused' });
        api.generation += 1;
        api.valid.clear();
        api.valid.add(`access-${api.generation}`);
        api.expectedRefresh = `refresh-${api.generation}`;
        return json(200, pair(api.generation, now()));
      }
      if (url.pathname === '/v1/auth/revoke') return new Response(null, { status: 204 });
      if (url.pathname === '/v1/me') {
        const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
        if (!token || !api.valid.has(token)) return problem(401, 'unauthenticated');
        return json(200, USER);
      }
      if (url.pathname === '/v1/auth/step-up')
        return problem(401, 'step_up_required', { reason: 'step_up_required' });
      return problem(404, 'not_found');
    },
  };
  return api;
}
