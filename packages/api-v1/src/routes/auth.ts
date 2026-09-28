import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { DomainError } from '@yayatoh/kernel';
import { myOrganizations } from '@yayatoh/tenancy';
import type { MobileSettings, V1Deps, V1Env } from '../context.ts';
import { RATE_LIMITS, type RateLimiter } from '../rate-limit.ts';
import { listSchema, Membership, MobileConfig, Session, TokenPair, toWire, User } from '../resources.ts';
import { body, json, problems, userSecurity } from './common.ts';
import { API_VERSION } from './version.ts';

const LoginBody = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
  .openapi('LoginRequest');

const TokenBody = z
  .discriminatedUnion('grantType', [
    z.object({
      grantType: z.literal('password'),
      email: z.email().max(254),
      password: z.string().min(1).max(128),
    }),
    z.object({ grantType: z.literal('refresh_token'), refreshToken: z.string().min(1).max(200) }),
  ])
  .openapi('TokenRequest');

const token = createRoute({
  method: 'post',
  path: '/auth/token',
  tags: ['auth'],
  summary:
    'Sign in (grantType password) or refresh (grantType refresh_token): a 15-minute access token and a rotating refresh token',
  description:
    'Each refresh spends the refresh token and returns a new pair; the previous access token ends. A spent refresh token presented again revokes its whole chain (every access token issued from it ends), answering `401` with `reason: refresh_token_reused`.',
  request: body(TokenBody),
  responses: { 200: json(TokenPair, 'Tokens'), ...problems },
});

const RevokeBody = z.object({ refreshToken: z.string().min(1).max(200) }).openapi('RevokeRequest');

const revoke = createRoute({
  method: 'post',
  path: '/auth/revoke',
  tags: ['auth'],
  summary: 'Sign out a refresh token: its chain and every access token issued from it end',
  request: body(RevokeBody),
  responses: { 204: { description: 'Revoked (unknown tokens too)' }, ...problems },
});

const login = createRoute({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Sign in with email and password; returns a bearer session token (no cookies)',
  request: body(LoginBody),
  responses: { 200: json(Session, 'Signed in'), ...problems },
});
const refresh = createRoute({
  method: 'post',
  path: '/auth/refresh',
  tags: ['auth'],
  summary: 'Keep a session alive: returns the token with its extended expiry',
  security: userSecurity,
  responses: { 200: json(Session, 'The session'), ...problems },
});
const logout = createRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  summary: 'End the session; the token stops working at once',
  security: userSecurity,
  responses: { 204: { description: 'Signed out' }, ...problems },
});
const me = createRoute({
  method: 'get',
  path: '/me',
  tags: ['me'],
  summary: 'The signed-in user',
  security: userSecurity,
  responses: { 200: json(User, 'The user'), ...problems },
});
const myOrgs = createRoute({
  method: 'get',
  path: '/me/organizations',
  tags: ['me'],
  summary: 'Organizations the signed-in user belongs to, with their role',
  security: userSecurity,
  responses: { 200: json(listSchema(Membership, 'MembershipList'), 'Memberships'), ...problems },
});
const mobileConfig = createRoute({
  method: 'get',
  path: '/mobile/config',
  tags: ['mobile'],
  summary: 'Minimum and latest app versions, base URLs and feature flags (public)',
  responses: { 200: json(MobileConfig, 'Mobile configuration') },
});

const DEFAULT_MOBILE: MobileSettings = {
  minimumVersions: { ios: '0.0.0', android: '0.0.0' },
  latestVersions: { ios: '0.0.0', android: '0.0.0' },
  baseUrls: { api: 'https://api.yayatoh.com/v1', web: 'https://app.yayatoh.com' },
  features: { wallet: false, rsvp: false, agenda: false, offlineScanning: true },
};

function userOf(c: { get(k: 'principal'): V1Env['Variables']['principal'] }) {
  const p = c.get('principal');
  if (p?.kind !== 'user') throw new DomainError('unauthenticated', 'A user session is required');
  return p.session;
}

export function authRoutes(deps: V1Deps, limiter: RateLimiter, ipOf: (h: Headers) => string) {
  const mobile: MobileSettings = { ...DEFAULT_MOBILE, ...deps.mobile };
  const sessions = () => {
    if (!deps.sessions) throw new DomainError('not_found', 'Sessions are not available on this host');
    return deps.sessions();
  };
  const loginLimits = (email: string, ip: string) => {
    // Per account (5 per 15 min) and per IP (100 per min): brute force is slowed, venues are not locked out.
    for (const [key, rule] of [
      [`login:acct:${email.toLowerCase()}`, RATE_LIMITS.loginAccount],
      [`login:ip:${ip}`, RATE_LIMITS.loginIp],
    ] as const) {
      const d = limiter.take(key, rule.limit, rule.window);
      if (!d.allowed)
        throw new DomainError('rate_limited', 'Too many sign-in attempts', { retryAfter: d.resetSeconds });
    }
  };
  return new OpenAPIHono<V1Env>()
    .openapi(token, async (c) => {
      const req = c.req.valid('json');
      const ip = ipOf(c.req.raw.headers);
      if (req.grantType === 'password') {
        loginLimits(req.email, ip);
        const r = await sessions().signInForTokens(req.email, req.password);
        if (!r.ok) {
          throw r.reason === 'two_factor_required'
            ? new DomainError(
                'step_up_required',
                'This account uses two-factor sign-in; use the web sign-in',
                {
                  reason: 'two_factor_required',
                },
              )
            : new DomainError('unauthenticated', 'Wrong email or password', {
                reason: 'invalid_credentials',
              });
        }
        return c.json(toWire(TokenPair, { ...r.tokens, tokenType: 'bearer' }), 200);
      }
      const d = limiter.take(`refresh:ip:${ip}`, RATE_LIMITS.loginIp.limit, RATE_LIMITS.loginIp.window);
      if (!d.allowed)
        throw new DomainError('rate_limited', 'Too many requests', { retryAfter: d.resetSeconds });
      const r = await sessions().refresh(req.refreshToken);
      if (!r.ok)
        throw new DomainError('unauthenticated', 'The refresh token cannot be used', {
          reason: r.reason === 'reused' ? 'refresh_token_reused' : `refresh_token_${r.reason}`,
        });
      return c.json(toWire(TokenPair, { ...r.tokens, tokenType: 'bearer' }), 200);
    })
    .openapi(revoke, async (c) => {
      await sessions().revokeRefresh(c.req.valid('json').refreshToken);
      return c.body(null, 204);
    })
    .openapi(login, async (c) => {
      const { email, password } = c.req.valid('json');
      loginLimits(email, ipOf(c.req.raw.headers));
      const r = await sessions().signIn(email, password);
      if (!r.ok) {
        throw r.reason === 'two_factor_required'
          ? new DomainError('step_up_required', 'This account uses two-factor sign-in; use the web sign-in', {
              reason: 'two_factor_required',
            })
          : new DomainError('unauthenticated', 'Wrong email or password', { reason: 'invalid_credentials' });
      }
      return c.json(toWire(Session, { ...r.session, tokenType: 'bearer' }), 200);
    })
    .openapi(refresh, async (c) => {
      const s = userOf(c);
      const fresh = (await sessions().session(s.token)) ?? s;
      return c.json(toWire(Session, { ...fresh, tokenType: 'bearer' }), 200);
    })
    .openapi(logout, async (c) => {
      await sessions().signOut(userOf(c).token);
      return c.body(null, 204);
    })
    .openapi(me, (c) => c.json(toWire(User, userOf(c).user), 200))
    .openapi(myOrgs, async (c) => {
      const orgs = await myOrganizations(userOf(c).user.id);
      return c.json(
        toWire(listSchema(Membership, 'MembershipList'), {
          data: orgs.map((o) => ({ id: o.orgId, slug: o.slug, name: o.name, role: o.role })),
        }),
        200,
      );
    })
    .openapi(mobileConfig, (c) => c.json(toWire(MobileConfig, { apiVersion: API_VERSION, ...mobile }), 200));
}
