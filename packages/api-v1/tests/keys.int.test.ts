import { randomBytes } from 'node:crypto';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { type ApiAccessQuotas, setEntitlementOverrideCommand } from '@yayatoh/billing';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import {
  API_KEY_SCOPES,
  type ApiKeyScope,
  addMemberCommand,
  apiUsageQuery,
  createApiKeyCommand,
  createSandboxOrg,
  revokeApiKeyCommand,
  rotateApiKeyCommand,
} from '@yayatoh/tenancy';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '@yayatoh/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, memoryRateLimiter, openApiDocument, type V1Deps } from '../src/index.ts';

const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const deps: V1Deps = {
  ports,
  sessions: () => bearerSessions(auth),
  payments: () => payments,
  telemetry: false,
};
const mount = (overrides: Partial<V1Deps> = {}) => {
  const app = new Hono();
  app.route('/v1', createV1({ ...deps, ...overrides }));
  return app;
};
const app = mount();

type Json = Record<string, unknown>;
async function call(
  target: Hono,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await target.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Json | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Json) : null;
  } catch {
    parsed = { text };
  }
  return { res, status: res.status, body: parsed as Json };
}

const key = async (org: OrgFixture, scopes: readonly ApiKeyScope[], extra: Json = {}) =>
  executeCommand(
    createApiKeyCommand,
    { name: `K ${randomBytes(3).toString('hex')}`, scopes, ...extra },
    org.ctx(),
    ports,
  );

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('rate limits per entitlement (M6.3a)', () => {
  const small: ApiAccessQuotas = {
    requestsPerMinute: 3,
    orgRequestsPerMinute: 5,
    testKeyRequestsPerMinute: 2,
    sandboxRequestsPerMinute: 3,
  };

  it('uses the plan’s api_access quotas: 600 a minute per live key, 120 per test key, 300 in a sandbox', async () => {
    const live = await call(app, 'GET', `/orgs/${a.org.slug}`, a.apiKey);
    expect(live.status).toBe(200);
    expect(live.res.headers.get('ratelimit-limit')).toBe('600');
    expect(live.res.headers.get('ratelimit-policy')).toBe('600;w=60');
    const test = await call(app, 'GET', `/orgs/${a.org.slug}`, a.testKey);
    expect(test.res.headers.get('ratelimit-limit')).toBe('120');
    const s = await createSandboxOrg(a.ctx(), { name: 'Rate sandbox' }, ports);
    const sk = await executeCommand(
      createApiKeyCommand,
      { name: 'Sandbox', scopes: ['org:read'] },
      userCtx(a.ownerId, s.sandboxOrgId),
      ports,
    );
    const sandbox = await call(app, 'GET', `/orgs/${s.slug}`, sk.key);
    expect(sandbox.status).toBe(200);
    expect(sandbox.res.headers.get('ratelimit-limit')).toBe('300');
    const self = await call(app, 'GET', `/orgs/${s.slug}/api-key`, sk.key);
    expect(self.body).toMatchObject({ sandboxOrg: true, test: false, rateLimit: { keyPerMinute: 300 } });
  });

  it('counts down per key, then answers 429 with Retry-After and problem+json', async () => {
    let now = 1_000_000;
    const limited = mount({
      apiQuotas: async () => small,
      rateLimiter: memoryRateLimiter({ clock: () => now }),
    });
    const k = await key(a, ['org:read']);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await call(limited, 'GET', `/orgs/${a.org.slug}`, k.key);
      expect(r.status).toBe(200);
      expect(r.res.headers.get('ratelimit-limit')).toBe('3');
      expect(r.res.headers.get('ratelimit-policy')).toBe('3;w=60');
      seen.push(r.res.headers.get('ratelimit-remaining'));
    }
    expect(seen).toEqual(['2', '1', '0']);
    const refused = await call(limited, 'GET', `/orgs/${a.org.slug}`, k.key);
    expect(refused.status).toBe(429);
    expect(refused.res.headers.get('content-type')).toBe('application/problem+json');
    expect(refused.body.code).toBe('rate_limited');
    expect(refused.res.headers.get('ratelimit-remaining')).toBe('0');
    const retry = Number(refused.res.headers.get('retry-after'));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(20);
    expect(Number(refused.res.headers.get('ratelimit-reset'))).toBe(retry);
    // A token comes back after Retry-After.
    now += retry * 1000;
    expect((await call(limited, 'GET', `/orgs/${a.org.slug}`, k.key)).status).toBe(200);
  });

  it('caps every key of the org together, and the headers report the org budget when it binds', async () => {
    const limited = mount({
      apiQuotas: async () => small,
      rateLimiter: memoryRateLimiter({ clock: () => 5 }),
    });
    const k1 = await key(a, ['org:read']);
    const k2 = await key(a, ['org:read']);
    for (let i = 0; i < 3; i++)
      expect((await call(limited, 'GET', `/orgs/${a.org.slug}`, k1.key)).status).toBe(200);
    const fourth = await call(limited, 'GET', `/orgs/${a.org.slug}`, k2.key);
    expect(fourth.status).toBe(200);
    expect(fourth.res.headers.get('ratelimit-limit')).toBe('5');
    expect(fourth.res.headers.get('ratelimit-remaining')).toBe('1');
    expect((await call(limited, 'GET', `/orgs/${a.org.slug}`, k2.key)).status).toBe(200);
    const over = await call(limited, 'GET', `/orgs/${a.org.slug}`, k2.key);
    expect(over.status).toBe(429);
    expect(over.res.headers.get('ratelimit-limit')).toBe('5');
    // Another org's keys have their own budget.
    expect((await call(limited, 'GET', `/orgs/${b.org.slug}`, b.apiKey)).status).toBe(200);
  });

  it('refuses every key of an org whose plan lacks api_access (403 module_not_enabled)', async () => {
    const { a: c } = await twoOrgs();
    const fresh = mount({ quotaCacheMs: 0 });
    expect((await call(fresh, 'GET', `/orgs/${c.org.slug}`, c.apiKey)).status).toBe(200);
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'api_access', effect: 'revoke', reason: 'test' },
      systemCtx(c.org.id),
      ports,
    );
    const r = await call(fresh, 'GET', `/orgs/${c.org.slug}`, c.apiKey);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('module_not_enabled');
    // Creating keys needs the module too.
    await expect(key(c, ['org:read'])).rejects.toMatchObject({ code: 'module_not_enabled' });
  });
});

describe('key lifetimes over /v1 (M6.3a)', () => {
  it('a revoked key fails on the very next request', async () => {
    const k = await key(a, ['org:read']);
    expect((await call(app, 'GET', `/orgs/${a.org.slug}`, k.key)).status).toBe(200);
    await executeCommand(revokeApiKeyCommand, { apiKeyId: k.id }, a.ctx(), ports);
    const r = await call(app, 'GET', `/orgs/${a.org.slug}`, k.key);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('unauthenticated');
  });

  it('rotation: both keys work during the overlap; with none, the old one fails at once', async () => {
    const k = await key(a, ['org:read', 'events:read']);
    const r = await executeCommand(rotateApiKeyCommand, { apiKeyId: k.id, overlapHours: 1 }, a.ctx(), ports);
    expect((await call(app, 'GET', `/orgs/${a.org.slug}/events`, k.key)).status).toBe(200);
    expect((await call(app, 'GET', `/orgs/${a.org.slug}/events`, r.key)).status).toBe(200);
    const old = await call(app, 'GET', `/orgs/${a.org.slug}/api-key`, k.key);
    expect(old.body).toMatchObject({ rotated: true, scopes: ['org:read', 'events:read'] });
    const r2 = await executeCommand(rotateApiKeyCommand, { apiKeyId: r.id, overlapHours: 0 }, a.ctx(), ports);
    expect((await call(app, 'GET', `/orgs/${a.org.slug}`, r.key)).status).toBe(401);
    expect((await call(app, 'GET', `/orgs/${a.org.slug}`, r2.key)).status).toBe(200);
  });

  it('an expired key answers 401', async () => {
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Expired', scopes: ['org:read'], expiresInDays: 30 },
      a.ctx({ now: new Date(Date.now() - 31 * 86_400_000) }),
      ports,
    );
    expect((await call(app, 'GET', `/orgs/${a.org.slug}`, k.key)).status).toBe(401);
  });

  it('describes the calling key without its secret; a session or another org gets nothing', async () => {
    const k = await key(a, ['events:read'], { expiresInDays: 90 });
    const r = await call(app, 'GET', `/orgs/${a.org.slug}/api-key`, k.key);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: k.id,
      prefix: k.prefix,
      scopes: ['events:read'],
      test: false,
      sandboxOrg: false,
      rotated: false,
      rateLimit: { keyPerMinute: 600, orgPerMinute: 1200 },
    });
    expect(typeof r.body.expiresAt).toBe('string');
    expect(JSON.stringify(r.body)).not.toContain(k.key);
    expect((await call(app, 'GET', `/orgs/${b.org.slug}/api-key`, k.key)).status).toBe(404);
    const email = `self-${randomBytes(4).toString('hex')}@example.test`;
    const u = await auth.api.signUpEmail({
      body: { email, password: 'correct horse battery', name: 'Self' },
    });
    await executeCommand(addMemberCommand, { userId: u.user.id, role: 'admin' }, a.ctx(), ports);
    const login = await call(app, 'POST', '/auth/login', undefined, {
      email,
      password: 'correct horse battery',
    });
    const session = await call(app, 'GET', `/orgs/${a.org.slug}/api-key`, String(login.body.token));
    expect(session.status).toBe(403);
  });
});

describe('daily key usage over /v1 (M6.3a)', () => {
  it('counts every request of a key, its errors and its 429s', async () => {
    const limited = mount({
      apiQuotas: async () => ({
        requestsPerMinute: 4,
        orgRequestsPerMinute: 100,
        testKeyRequestsPerMinute: 4,
        sandboxRequestsPerMinute: 4,
      }),
      rateLimiter: memoryRateLimiter({ clock: () => 9 }),
    });
    const k = await key(a, ['org:read']);
    expect((await call(limited, 'GET', `/orgs/${a.org.slug}`, k.key)).status).toBe(200);
    expect((await call(limited, 'GET', `/orgs/${a.org.slug}/events`, k.key)).status).toBe(403);
    expect((await call(limited, 'GET', `/orgs/${a.org.slug}/nope`, k.key)).status).toBe(404);
    expect((await call(limited, 'GET', `/orgs/${a.org.slug}`, k.key)).status).toBe(200);
    expect((await call(limited, 'GET', `/orgs/${a.org.slug}`, k.key)).status).toBe(429);
    const u = await executeQuery(apiUsageQuery, { days: 1 }, a.ctx(), ports);
    expect(u.keys.find((x) => x.apiKeyId === k.id)).toMatchObject({ requests: 5, errors: 3, rateLimited: 1 });
  });
});

/**
 * Generated from the OpenAPI document (M6.3a acceptance): every operation under
 * `/v1/orgs/{org}` is tried with a key of another org (always 404) and with a key holding every
 * scope except the one the operation documents (never a success; a read is exactly 403).
 */
describe('a key never exceeds its scopes or its org (generated from /v1)', () => {
  const doc = openApiDocument(deps) as unknown as {
    paths: Record<
      string,
      Record<
        string,
        {
          summary?: string;
          description?: string;
          operationId: string;
          parameters?: { name: string; in: string; required?: boolean }[];
        }
      >
    >;
  };
  const SCOPE = /[Ss]cope `([a-z_]+:[a-z_]+)`/;
  // Operations whose scope depends on the request (bulk kinds) or that need no scope.
  const NO_SINGLE_SCOPE = new Set(['getCurrentApiKey', 'getBulkOperation', 'undoBulkOperation']);
  const ops = Object.entries(doc.paths)
    .filter(([path]) => path.startsWith('/v1/orgs/{org}'))
    .flatMap(([path, byMethod]) =>
      Object.entries(byMethod)
        .filter(([m]) => ['get', 'post', 'patch', 'put', 'delete'].includes(m))
        .map(([method, op]) => ({
          path,
          method: method.toUpperCase(),
          operationId: op.operationId,
          scope: SCOPE.exec(`${op.summary ?? ''} ${op.description ?? ''}`)?.[1] as ApiKeyScope | undefined,
          // Required query parameters get a plain value, so a read reaches the scope check.
          query: (op.parameters ?? [])
            .filter((x) => x.in === 'query' && x.required)
            .map((x) => `${x.name}=test`)
            .join('&'),
        })),
    );
  const concrete = (path: string, org: string, query = '') =>
    path
      .replace('/v1', '')
      .replace('{org}', org)
      .replace(/\{[A-Za-z]+\}/g, () => '00000000-0000-4000-8000-000000000000') + (query ? `?${query}` : '');

  it('documents a scope on every org operation', () => {
    expect(ops.length).toBeGreaterThan(20);
    const missing = ops
      .filter((o) => !o.scope && !NO_SINGLE_SCOPE.has(o.operationId))
      .map((o) => o.operationId);
    expect(missing).toEqual([]);
    for (const o of ops) if (o.scope) expect(API_KEY_SCOPES).toContain(o.scope);
  });

  it('another org’s key gets 404 on every org operation', async () => {
    for (const o of ops) {
      const r = await call(
        app,
        o.method,
        concrete(o.path, a.org.slug),
        b.apiKey,
        o.method === 'GET' ? undefined : {},
        {
          'idempotency-key': `gen-${randomBytes(6).toString('hex')}`,
        },
      );
      expect(r.status, `${o.method} ${o.path}`).toBe(404);
    }
  });

  it('a key without the documented scope never succeeds (reads: 403); with it, reads pass the scope check', async () => {
    const keys = new Map<string, string>();
    for (const o of ops.filter((x) => x.scope)) {
      const scope = o.scope as ApiKeyScope;
      if (!keys.has(scope))
        keys.set(
          scope,
          (
            await key(
              a,
              API_KEY_SCOPES.filter((s) => s !== scope),
            )
          ).key,
        );
      const without = keys.get(scope) as string;
      const path = concrete(o.path, a.org.slug, o.query);
      const r = await call(app, o.method, path, without, o.method === 'GET' ? undefined : {}, {
        'idempotency-key': `gen-${randomBytes(6).toString('hex')}`,
      });
      expect(r.status, `${o.method} ${o.path} without ${scope}`).toBeGreaterThanOrEqual(400);
      if (o.method === 'GET') {
        expect(r.status, `${o.method} ${o.path} without ${scope}`).toBe(403);
        const only = (await key(a, [scope])).key;
        const ok = await call(app, o.method, path, only);
        expect(ok.status, `${o.method} ${o.path} with ${scope}`).not.toBe(403);
      }
    }
  });
});
