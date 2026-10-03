import { OpenAPIHono } from '@hono/zod-openapi';
import { type ApiAccessQuotas, apiAccessQuotas } from '@yayatoh/billing';
import { DEVICE_TOKEN_SCHEME, scannerRoutes } from '@yayatoh/checkin/routes';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { recordApiUsage } from '@yayatoh/platform';
import { apiKeyIdentity, memberRole, recordApiKeyUsage, resolveOrgSlug } from '@yayatoh/tenancy';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { Principal, V1Deps, V1Env } from './context.ts';
import { deprecationMiddleware } from './deprecation.ts';
import { onV1Error, problem, sendProblem } from './http.ts';
import { memoryRateLimiter, RATE_LIMITS, type RateDecision } from './rate-limit.ts';
import { authRoutes } from './routes/auth.ts';
import { bulkRoutes } from './routes/bulk.ts';
import { contentRoutes } from './routes/content.ts';
import { docsRoutes } from './routes/docs.ts';
import { health } from './routes/health.ts';
import { keyRoutes } from './routes/key.ts';
import { orgRoutes } from './routes/org.ts';
import { publicRoutes } from './routes/public.ts';
import { salesRoutes } from './routes/sales.ts';
import { API_VERSION } from './routes/version.ts';
import { clientInfo } from './telemetry.ts';

export { cachedJson, etagOf } from './caching.ts';
export type { MobileSettings, Principal, V1Deps } from './context.ts';
export { decodeCursor, encodeCursor, pageByKey, pageOf } from './cursor.ts';
export {
  type Deprecation,
  deprecated,
  deprecationHeaders,
  deprecationMiddleware,
  deprecations,
} from './deprecation.ts';
export { memoryRateLimiter, RATE_LIMITS, type RateDecision, type RateLimiter } from './rate-limit.ts';
export { API_VERSION } from './routes/version.ts';
export { type ClientInfo, clientInfo } from './telemetry.ts';

/** Every operation's tag, described (Spectral `openapi-tags`, `tag-description`). */
const API_TAGS = [
  { name: 'system', description: 'Liveness and the API document.' },
  { name: 'auth', description: 'Bearer sessions for mobile and command-line clients.' },
  { name: 'me', description: 'The signed-in user and their organizations.' },
  { name: 'mobile', description: 'Configuration for the mobile apps (versions, base URLs, flags).' },
  { name: 'public', description: 'Published events and their passes, without a credential.' },
  {
    name: 'public content',
    description:
      'Event page content, dates, agenda, speakers, sponsors, images and venues, without a credential.',
  },
  { name: 'organizations', description: 'The organization an API key or session belongs to.' },
  { name: 'events', description: 'The organization’s events.' },
  { name: 'event content', description: 'Sections, announcements, dates and the program of an event.' },
  { name: 'venues', description: 'The organization’s saved venues.' },
  { name: 'ticket types', description: 'Passes and their prices.' },
  { name: 'orders', description: 'Orders, tickets and refunds.' },
  { name: 'attendees', description: 'Attendees and search.' },
  {
    name: 'bulk actions',
    description: 'Label, email, seat, resend or cancel many attendees at once; progress and undo.',
  },
  { name: 'check-in', description: 'Online scans with an API key or session.' },
  { name: 'scanner', description: 'The Scan PWA’s device-token routes (manifest, offline sync).' },
];

export const OPENAPI_INFO = {
  openapi: '3.1.0',
  info: {
    title: 'Yayatoh API',
    version: API_VERSION,
    description: [
      'Yayatoh `/v1`. Changes are additive only (oasdiff gate).',
      '',
      '- **Auth:** an org API key (`Authorization: Bearer yy_live_…`, created in the console under',
      '  Settings → API keys) or a user token: `POST /v1/auth/token` (15-minute access token and a',
      '  rotating refresh token; recommended) or `POST /v1/auth/login` (a 14-day session). No cookies.',
      '- **Test keys:** `yy_test_…` keys are read-only and carry no personal data (`org:read`,',
      '  `events:read` only), with a smaller rate limit. Build against them, ship with a live key.',
      '- **Tenant:** org resources live under `/v1/orgs/{org}`; the org must match the key, or the',
      '  user must be a member. It is never read from a header.',
      '- **Pagination:** `limit` (≤ 100) and `cursor` (the previous page’s `nextCursor`).',
      '- **Errors:** RFC 9457 `application/problem+json` with a stable `code`.',
      '- **Idempotency:** every write needs an `Idempotency-Key`; a retry returns the stored result.',
      '- **Rate limits:** per key or user, with `RateLimit-Limit`, `RateLimit-Remaining`,',
      '  `RateLimit-Reset` and `RateLimit-Policy` headers and `Retry-After` on 429. An API key gets',
      '  its plan’s `api_access` quotas: a per-minute budget per key and one for the whole org.',
      '- **Key lifetimes:** a key may expire (30, 90 or 365 days) and can be rotated with an overlap',
      '  window; an expired, rotated-out or revoked key answers 401 on the next request.',
      '- **Sandbox orgs:** create one from Settings → Sandboxes for seeded data and fake payments;',
      '  its keys work exactly like live ones, and it never takes real money.',
      '- **Request ids:** every response has `X-Request-Id` (send your own to correlate).',
      '- **Caching:** content reads send an `ETag`; send it back as `If-None-Match` for a 304.',
      '- **Deprecation:** a deprecated route answers with `Deprecation` (RFC 9745) and, once a',
      '  date is set, `Sunset` (RFC 8594) and a `Link` to the migration notes.',
    ].join('\n'),
  },
  tags: API_TAGS,
} as const;

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client IP for anonymous limits only (never for tenancy): the first X-Forwarded-For hop. */
export function clientIp(h: Headers): string {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

/**
 * The org's `api_access` quotas (M6.3a), cached per org for `ttlMs` so a key's requests don't
 * each read the plan. A plan change or a revoked module applies within that window.
 */
function quotaCache(load: (orgId: string) => Promise<ApiAccessQuotas | null>, ttlMs: number) {
  const cache = new Map<string, { at: number; q: Promise<ApiAccessQuotas | null> }>();
  return (orgId: string) => {
    const now = Date.now();
    const hit = cache.get(orgId);
    if (hit && now - hit.at < ttlMs) return hit.q;
    const q = load(orgId).catch((err: unknown) => {
      cache.delete(orgId);
      throw err;
    });
    cache.set(orgId, { at: now, q });
    if (cache.size > 10_000) cache.delete(cache.keys().next().value as string);
    return q;
  };
}

/** The per-minute budget of one key (M6.3a): test keys, sandbox orgs' keys and live keys. */
export function keyRequestsPerMinute(q: ApiAccessQuotas, key: { sandbox: boolean; orgSandbox: boolean }) {
  if (key.sandbox) return Math.min(q.testKeyRequestsPerMinute, q.requestsPerMinute);
  if (key.orgSandbox) return Math.min(q.sandboxRequestsPerMinute, q.requestsPerMinute);
  return q.requestsPerMinute;
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
  const quotasFor = quotaCache(
    deps.apiQuotas ??
      ((orgId) => apiAccessQuotas(createCtx({ orgId, actor: { type: 'system', name: 'api-quotas' } }))),
    deps.quotaCacheMs ?? 30_000,
  );
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
  // Deprecation / Sunset headers for routes marked with `deprecated()` (none yet).
  v1.use('*', deprecationMiddleware(v1 as never, basePath));

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

  // M6.3a: every request made with an org API key is counted per key and day (status ≥ 400 as an
  // error, 429 as rate limited), after the response is decided. Never fails the request.
  if (deps.keyUsage !== false) {
    v1.use('*', async (c, next) => {
      await next();
      const p = c.get('principal');
      if (p?.kind !== 'api_key') return;
      await recordApiKeyUsage({ orgId: p.key.orgId, keyId: p.key.keyId, status: c.res.status }).catch(
        (err: unknown) => console.warn('api key usage not recorded', err),
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
        if (!key) throw new DomainError('unauthenticated', 'Unknown, expired or revoked API key');
        c.set('principal', { kind: 'api_key', key });
      } else {
        const session = deps.sessions ? await deps.sessions().session(token) : null;
        if (!session) throw new DomainError('unauthenticated', 'Unknown or expired session');
        c.set('principal', { kind: 'user', session });
      }
    }
    // Rate limit per credential; anonymous callers per IP with a generous budget. An org API key
    // (M6.3a) gets its plan's `api_access` quotas: a budget per key and one for the whole org; the
    // headers describe the tighter of the two. Without the module its keys are refused.
    const p = c.get('principal');
    const device = token?.startsWith('yyd_');
    let d: RateDecision;
    let window: number;
    if (p?.kind === 'api_key') {
      const q = await quotasFor(p.key.orgId);
      if (!q)
        throw new DomainError('module_not_enabled', 'API access is not part of this organization’s plan', {
          module: 'api_access',
        });
      window = 60;
      const perKey = limiter.take(credentialKey(p), keyRequestsPerMinute(q, p.key), window);
      const perOrg = perKey.allowed
        ? limiter.take(`org:${p.key.orgId}`, q.orgRequestsPerMinute, window)
        : perKey;
      d = !perOrg.allowed || perOrg.remaining < perKey.remaining ? perOrg : perKey;
    } else {
      const rule = p ? RATE_LIMITS.credential : device ? { limit: 3000, window: 60 } : RATE_LIMITS.anonymous;
      const key = p
        ? credentialKey(p)
        : device
          ? `device:${token?.slice(0, 20)}`
          : `ip:${clientIp(c.req.raw.headers)}`;
      window = rule.window;
      d = limiter.take(key, rule.limit, rule.window);
    }
    c.header('ratelimit-limit', String(d.limit));
    c.header('ratelimit-remaining', String(d.remaining));
    c.header('ratelimit-reset', String(d.resetSeconds));
    c.header('ratelimit-policy', `${d.limit};w=${window}`);
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
  v1.route('/', contentRoutes(deps));
  v1.route('/', orgRoutes(deps));
  v1.route(
    '/',
    keyRoutes(async (orgId, key) => {
      const q = await quotasFor(orgId);
      return q ? { keyPerMinute: keyRequestsPerMinute(q, key), orgPerMinute: q.orgRequestsPerMinute } : null;
    }),
  );
  v1.route('/', salesRoutes(deps, limiter, credentialKey));
  v1.route('/', bulkRoutes(deps));
  v1.route('/', scannerRoutes(deps.ports));
  v1.route('/', docsRoutes(basePath));

  v1.openAPIRegistry.registerComponent('securitySchemes', 'deviceToken', DEVICE_TOKEN_SCHEME);
  v1.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', {
    type: 'http',
    scheme: 'bearer',
    description:
      'An org API key (`yy_live_…`, or a read-only `yy_test_…` test key). Shown once when created; scoped; bound to one org.',
  });
  v1.openAPIRegistry.registerComponent('securitySchemes', 'bearerSession', {
    type: 'http',
    scheme: 'bearer',
    description:
      'A user access token from `POST /v1/auth/token`, or a session token from `POST /v1/auth/login`.',
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
