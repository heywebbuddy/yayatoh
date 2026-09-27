import { OpenAPIHono } from '@hono/zod-openapi';
import { DEVICE_TOKEN_SCHEME, scannerRoutes } from '@yayatoh/checkin/routes';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { recordApiUsage } from '@yayatoh/platform';
import { apiKeyIdentity, memberRole, resolveOrgSlug } from '@yayatoh/tenancy';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { Principal, V1Deps, V1Env } from './context.ts';
import { onV1Error, problem, sendProblem } from './http.ts';
import { memoryRateLimiter, RATE_LIMITS } from './rate-limit.ts';
import { authRoutes } from './routes/auth.ts';
import { docsRoutes } from './routes/docs.ts';
import { health } from './routes/health.ts';
import { orgRoutes } from './routes/org.ts';
import { publicRoutes } from './routes/public.ts';
import { salesRoutes } from './routes/sales.ts';
import { API_VERSION } from './routes/version.ts';
import { clientInfo } from './telemetry.ts';

export type { MobileSettings, Principal, V1Deps } from './context.ts';
export { decodeCursor, encodeCursor, pageOf } from './cursor.ts';
export { memoryRateLimiter, RATE_LIMITS, type RateDecision, type RateLimiter } from './rate-limit.ts';
export { API_VERSION } from './routes/version.ts';
export { type ClientInfo, clientInfo } from './telemetry.ts';

export const OPENAPI_INFO = {
  openapi: '3.1.0',
  info: {
    title: 'Yayatoh API',
    version: API_VERSION,
    description: [
      'Yayatoh `/v1`. Changes are additive only (oasdiff gate).',
      '',
      '- **Auth:** an org API key (`Authorization: Bearer yy_live_…`, created in the console under',
      '  Settings → API keys) or a user session token from `POST /v1/auth/login`. No cookies.',
      '- **Tenant:** org resources live under `/v1/orgs/{org}`; the org must match the key, or the',
      '  user must be a member. It is never read from a header.',
      '- **Pagination:** `limit` (≤ 100) and `cursor` (the previous page’s `nextCursor`).',
      '- **Errors:** RFC 9457 `application/problem+json` with a stable `code`.',
      '- **Idempotency:** every write needs an `Idempotency-Key`; a retry returns the stored result.',
      '- **Rate limits:** per key or user, with `RateLimit-*` headers and `Retry-After` on 429.',
      '- **Request ids:** every response has `X-Request-Id` (send your own to correlate).',
    ].join('\n'),
  },
} as const;

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client IP for anonymous limits only (never for tenancy): the first X-Forwarded-For hop. */
export function clientIp(h: Headers): string {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

const credentialKey = (p: Principal | null) =>
  p?.kind === 'api_key' ? `key:${p.key.keyId}` : p?.kind === 'user' ? `user:${p.session.user.id}` : 'anon';

/**
 * The `/v1` router (roadmap §6.1). `apps/api` mounts it at `/v1` (api.yayatoh.com) and the web
 * app at `/api/v1`, so the Scan PWA and the console's own origin serve the same contract.
 */
export function createV1(deps: V1Deps) {
  const basePath = deps.basePath ?? '/v1';
  const limiter = deps.rateLimiter ?? memoryRateLimiter();
  const v1 = new OpenAPIHono<V1Env>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new DomainError('validation_failed', 'Invalid request', {
          issues: result.error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
        });
      }
    },
  });
  v1.onError(onV1Error);
  v1.notFound((c) => sendProblem(c, problem('not_found')));

  // Request id: echo a well-formed client id, else mint one. It lands in audit rows via the ctx.
  v1.use('*', async (c, next) => {
    const given = c.req.header('x-request-id');
    const id = given && REQUEST_ID.test(given) ? given : crypto.randomUUID();
    c.set('requestId', id);
    c.header('x-request-id', id);
    await next();
  });

  // App-version telemetry per route (M1.15). Best effort: never delays or fails a request.
  if (deps.telemetry !== false) {
    v1.use('*', async (c, next) => {
      await next();
      const route = routePath(c);
      if (!route || route === '/*' || route.includes('/docs') || route.endsWith('/openapi.json')) return;
      const info = clientInfo(c.req.raw.headers);
      void recordApiUsage({ route: route.replace(basePath, '') || '/', method: c.req.method, ...info }).catch(
        (err: unknown) => console.warn('api usage not recorded', err),
      );
    });
  }

  // Credential → principal. Device tokens (`yyd_`) are left to the scanner routes.
  v1.use('*', async (c, next) => {
    c.set('principal', null);
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    const token = m?.[1];
    if (token && !token.startsWith('yyd_')) {
      if (token.startsWith('yy_')) {
        const key = await apiKeyIdentity(token);
        if (!key) throw new DomainError('unauthenticated', 'Unknown or revoked API key');
        c.set('principal', { kind: 'api_key', key });
      } else {
        const session = deps.sessions ? await deps.sessions().session(token) : null;
        if (!session) throw new DomainError('unauthenticated', 'Unknown or expired session');
        c.set('principal', { kind: 'user', session });
      }
    }
    // Rate limit per credential; anonymous callers per IP with a generous budget.
    const p = c.get('principal');
    const device = token?.startsWith('yyd_');
    const rule = p ? RATE_LIMITS.credential : device ? { limit: 3000, window: 60 } : RATE_LIMITS.anonymous;
    const key = p
      ? credentialKey(p)
      : device
        ? `device:${token?.slice(0, 20)}`
        : `ip:${clientIp(c.req.raw.headers)}`;
    const d = limiter.take(key, rule.limit, rule.window);
    c.header('ratelimit-limit', String(d.limit));
    c.header('ratelimit-remaining', String(d.remaining));
    c.header('ratelimit-reset', String(d.resetSeconds));
    if (!d.allowed)
      throw new DomainError('rate_limited', 'Rate limit exceeded', { retryAfter: d.resetSeconds });
    await next();
  });

  // `/orgs/{org}/…`: the org comes from the path and must match the key's org or the user's
  // membership. Anything else is a 404, so an org's existence is not revealed.
  const orgScope = createMiddleware<V1Env>(async (c, next) => {
    const p = c.get('principal');
    if (!p) throw new DomainError('unauthenticated', 'An API key or a session is required');
    const param = c.req.param('org') ?? '';
    const orgId = UUID.test(param) ? param.toLowerCase() : (await resolveOrgSlug(param))?.orgId;
    if (!orgId) throw new DomainError('not_found', 'Organization not found');
    const idempotencyKey = c.req.header('idempotency-key') ?? null;
    const base = {
      orgId,
      requestId: c.get('requestId'),
      idempotencyKey,
      locale: (c.req.header('accept-language') ?? 'en').split(/[,;]/)[0]?.trim() || 'en',
    };
    if (p.kind === 'api_key') {
      if (p.key.orgId !== orgId) throw new DomainError('not_found', 'Organization not found');
      c.set('ctx', createCtx({ ...base, actor: { type: 'api_key', keyId: p.key.keyId } }));
    } else {
      const ctx = createCtx({ ...base, actor: { type: 'user', userId: p.session.user.id } });
      if (!(await memberRole(ctx))) throw new DomainError('not_found', 'Organization not found');
      c.set('ctx', ctx);
    }
    await next();
  });
  v1.use('/orgs/:org', orgScope);
  v1.use('/orgs/:org/*', orgScope);

  v1.route('/', health);
  v1.route('/', authRoutes(deps, limiter, clientIp));
  v1.route('/', publicRoutes());
  v1.route('/', orgRoutes(deps));
  v1.route('/', salesRoutes(deps, limiter, credentialKey));
  v1.route('/', scannerRoutes(deps.ports));
  v1.route('/', docsRoutes(basePath));

  v1.openAPIRegistry.registerComponent('securitySchemes', 'deviceToken', DEVICE_TOKEN_SCHEME);
  v1.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'An org API key (`yy_live_…`). Shown once when created; scoped; bound to one org.',
  });
  v1.openAPIRegistry.registerComponent('securitySchemes', 'bearerSession', {
    type: 'http',
    scheme: 'bearer',
    description: 'A user session token from `POST /v1/auth/login`.',
  });
  // The served document matches the committed one (paths under `/v1`); `servers` points at this
  // mount, so the web app's copy (`/api/v1`) is callable from the docs page too.
  let doc: ReturnType<OpenAPIHono['getOpenAPI31Document']> | undefined;
  v1.get('/openapi.json', (c) => {
    if (!doc) {
      const wrapper = new OpenAPIHono();
      wrapper.route('/v1', v1);
      doc = wrapper.getOpenAPI31Document(OPENAPI_INFO);
    }
    const prefix = basePath.replace(/\/v1$/, '');
    return c.json({ ...doc, servers: [{ url: `${new URL(c.req.url).origin}${prefix}` }] });
  });
  return v1;
}

/** The OpenAPI document for the committed `apps/api/openapi.json` (paths under `/v1`). */
export function openApiDocument(deps: V1Deps) {
  const app = new OpenAPIHono();
  app.route('/v1', createV1(deps));
  return app.getOpenAPI31Document(OPENAPI_INFO);
}
