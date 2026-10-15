/**
 * A scripted `/v1` for the screen tests (M7.3a): the sign-in, step-up, deletion and sign-out routes
 * answer the way the real server does (problem+json, `details.reason`, `Retry-After`), and every
 * call is recorded. Behaviour is switched through `server.config` per test.
 */
import type { Schemas } from '@yayatoh/sdk';

export const CODE = '123456';
export const TOTP = '654321';
export const BACKUP = 'abcd-efgh-ij';
export const PASSWORD = 'correct horse battery staple';

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly body: Record<string, unknown> | undefined;
}

export interface ServerConfig {
  /** Accounts that need an authenticator or backup code after the first factor. */
  twoFactor: boolean;
  /** Apple/Google sign-in finds an existing account with the same address. */
  providerEmailExists: boolean;
  /** The emailed sign-in code has expired (the server cannot tell it from a wrong one). */
  codeExpired: boolean;
  /** The sign-in code was tried too often: the server refuses it with `too_many_attempts`. */
  codeAttemptsExhausted: boolean;
  /** `POST /auth/email-code` answers 429 with this wait, in seconds. */
  emailCodeRateLimit: number | null;
  /** `POST /auth/token` answers 429 with this wait, in seconds. */
  tokenRateLimit: number | null;
  /** How this person confirms a step-up. */
  stepUpMethod: 'totp' | 'password' | 'email';
  /** Whether the session counts as freshly stepped up for `DELETE /me`. */
  stepUpFresh: boolean;
  /** The server stops counting the session as stepped up right after accepting a step-up (a lapse). */
  stepUpLapses: boolean;
  /** `DELETE /me` is refused: the person is the only owner of these organizations. */
  soleOwnerOf: string[];
  /** Every call fails like a dead network. */
  offline: boolean;
  /** `POST /auth/sign-out-everywhere` answers this status. */
  signOutEverywhereStatus: number;
}

export const USER: Schemas['User'] = {
  id: '00000000-0000-4000-8000-0000000000aa',
  email: 'ada@example.test',
  emailVerified: true,
  name: 'Ada Lovelace',
};

export function pair(n = 1, user: Schemas['User'] = USER): Schemas['TokenPair'] {
  const now = Date.now();
  return {
    accessToken: `access-${n}`,
    tokenType: 'bearer',
    accessTokenExpiresAt: new Date(now + 15 * 60_000).toISOString(),
    refreshToken: `refresh-${n}`,
    refreshTokenExpiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    user,
  };
}

const problem = (status: number, code: string, details: Record<string, unknown> = {}, headers = {}) =>
  new Response(JSON.stringify({ type: `https://x/${code}`, title: code, status, code, details }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createFakeServer() {
  const config: ServerConfig = {
    twoFactor: false,
    providerEmailExists: false,
    codeExpired: false,
    codeAttemptsExhausted: false,
    emailCodeRateLimit: null,
    tokenRateLimit: null,
    stepUpMethod: 'email',
    stepUpFresh: true,
    stepUpLapses: false,
    soleOwnerOf: [],
    offline: false,
    signOutEverywhereStatus: 204,
  };
  const calls: Call[] = [];
  let attempts = 0;
  let pendingFactor: 'two_factor' | 'link' | null = null;

  const challenge = (reason: 'two_factor_required' | 'email_proof_required') => {
    attempts = 0;
    pendingFactor = reason === 'two_factor_required' ? 'two_factor' : 'link';
    return problem(401, 'step_up_required', {
      reason,
      challenge: `yyc_${'A'.repeat(43)}`,
      challengeExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  };
  const refuse = (reason: string) => problem(401, 'unauthenticated', { reason });
  const rateLimited = (seconds: number) =>
    problem(429, 'rate_limited', { retryAfter: seconds }, { 'retry-after': String(seconds) });

  /** After a first factor: tokens, or the second step for accounts that have one. */
  const firstFactorDone = () => (config.twoFactor ? challenge('two_factor_required') : json(200, pair()));

  const token = (body: Record<string, unknown>): Response => {
    if (config.tokenRateLimit) return rateLimited(config.tokenRateLimit);
    switch (body.grantType) {
      case 'email_code':
        if (config.codeAttemptsExhausted) return refuse('too_many_attempts');
        if (config.codeExpired || body.code !== CODE) return refuse('invalid_code');
        return firstFactorDone();
      case 'password':
        return body.password === PASSWORD ? firstFactorDone() : refuse('invalid_credentials');
      case 'apple':
      case 'google':
        if (body.idToken === 'bad-token') return refuse('invalid_id_token');
        if (body.idToken === 'no-email') return refuse('provider_email_missing');
        return config.providerEmailExists ? challenge('email_proof_required') : firstFactorDone();
      case 'two_factor': {
        if (pendingFactor !== 'two_factor' || attempts >= 5) return refuse('invalid_challenge');
        if (body.code === TOTP || body.code === BACKUP) return json(200, pair());
        attempts += 1;
        return refuse(attempts >= 5 ? 'too_many_attempts' : 'invalid_code');
      }
      case 'link_proof':
        if (pendingFactor !== 'link') return refuse('invalid_challenge');
        if (body.code !== CODE) return refuse('invalid_code');
        return firstFactorDone();
      case 'refresh_token':
        return json(200, pair(2));
      default:
        return problem(400, 'validation_failed');
    }
  };

  const route = (method: string, path: string, body: Record<string, unknown> | undefined): Response => {
    if (method === 'GET' && path === '/v1/mobile/config') return problem(404, 'not_found');
    if (method === 'POST' && path === '/v1/auth/email-code') {
      if (config.emailCodeRateLimit) return rateLimited(config.emailCodeRateLimit);
      return json(202, { expiresInSeconds: 600 });
    }
    if (method === 'POST' && path === '/v1/auth/token') return token(body ?? {});
    if (method === 'POST' && path === '/v1/auth/revoke') return new Response(null, { status: 204 });
    if (method === 'POST' && path === '/v1/auth/step-up/start')
      return json(200, { method: config.stepUpMethod });
    if (method === 'POST' && path === '/v1/auth/step-up') {
      const ok =
        (body?.method === 'password' && body.password === PASSWORD) ||
        (body?.method === 'email' && body.code === CODE) ||
        (body?.method === 'totp' && (body.code === TOTP || body.code === BACKUP));
      if (!ok)
        return problem(400, 'validation_failed', {
          reason: body?.method === 'password' ? 'invalid_password' : 'invalid_code',
        });
      config.stepUpFresh = !config.stepUpLapses;
      return json(200, {
        stepUpAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    if (method === 'POST' && path === '/v1/auth/sign-out-everywhere') {
      return config.signOutEverywhereStatus === 204
        ? new Response(null, { status: 204 })
        : problem(config.signOutEverywhereStatus, 'internal');
    }
    if (method === 'DELETE' && path === '/v1/me') {
      if (!config.stepUpFresh) return problem(401, 'step_up_required', { reason: 'step_up_required' });
      if (config.soleOwnerOf.length > 0)
        return problem(409, 'invalid_state', { reason: 'last_owner', orgs: config.soleOwnerOf });
      return json(200, {
        requestId: '00000000-0000-4000-8000-0000000000bb',
        summary: {
          organizations: 0,
          memberships: 0,
          ordersUnlinked: 0,
          invitations: 0,
          sessions: 1,
          credentials: 1,
          signupCodes: 0,
        },
      });
    }
    return problem(404, 'not_found');
  };

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (config.offline) throw new TypeError('Network request failed');
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?(\/v1\/)/, '/v1/');
    const raw = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.clone().text();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    calls.push({ method: request.method, path, authorization: request.headers.get('authorization'), body });
    return route(request.method, path, body);
  };

  return {
    config,
    calls,
    fetch: fetchImpl,
    /** The calls to one route, in order. */
    to: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path),
    grants: () => calls.filter((c) => c.path === '/v1/auth/token').map((c) => c.body?.grantType),
  };
}

export type FakeServer = ReturnType<typeof createFakeServer>;
