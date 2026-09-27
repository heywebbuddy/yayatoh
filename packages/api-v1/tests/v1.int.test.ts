import { randomBytes } from 'node:crypto';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { enrollDeviceCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import { fakePaymentProvider } from '@yayatoh/payments';
import { addMemberCommand, createApiKeyCommand, revokeApiKeyCommand } from '@yayatoh/tenancy';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, memoryRateLimiter, type V1Deps } from '../src/index.ts';

const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const deps: V1Deps = {
  ports,
  sessions: () => bearerSessions(auth),
  payments: () => payments,
  telemetry: false,
};

function mount(overrides: Partial<V1Deps> = {}) {
  const app = new Hono();
  app.route('/v1', createV1({ ...deps, ...overrides }));
  return app;
}
const app = mount();

let a: OrgFixture;
let b: OrgFixture;
let draftId: string;
let paidOrderId: string;
let paidTicketIds: string[];
let readOnlyKey: string;
let viewerToken: string;
let viewerEmail: string;
const password = 'correct horse battery';
const suffix = randomBytes(4).toString('hex');

type Json = Record<string, unknown>;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const idem = () => ({ 'idempotency-key': `test-${randomBytes(8).toString('hex')}` });
async function call(method: string, path: string, token?: string, bodyJson?: unknown, headers: Json = {}) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? bearer(token) : {}),
      ...(bodyJson !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(headers as Record<string, string>),
    },
    body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
  });
  const text = await res.text();
  return { res, status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

async function signUp(name: string, role: 'viewer' | 'manager' | null, org: OrgFixture) {
  const email = `${name}-${suffix}@example.test`;
  const r = await auth.api.signUpEmail({ body: { email, password, name } });
  if (role) await executeCommand(addMemberCommand, { userId: r.user.id, role }, org.ctx(), ports);
  return { email, userId: r.user.id };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const draft = await executeCommand(
    createEventCommand,
    { name: 'API draft', timezone: 'UTC', startsAt: '2029-05-01T18:00:00Z', endsAt: '2029-05-01T22:00:00Z' },
    a.ctx(),
    ports,
  );
  draftId = draft.id;
  // A paid order on a published event, for orders and refunds.
  const e = await executeCommand(
    createEventCommand,
    { name: 'API sales', timezone: 'UTC', startsAt: '2029-06-01T18:00:00Z', endsAt: '2029-06-01T22:00:00Z' },
    a.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'GA', priceMinor: 4000, quantityTotal: 20 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId: e.id,
      items: [{ ticketTypeId: tt.id, quantity: 2 }],
      buyer: { email: 'api-buyer@example.test', name: 'Api Buyer' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  paidOrderId = c.order.id;
  await executeCommand(
    attachPaymentCommand,
    { orderId: paidOrderId, provider: 'fake', providerPaymentId: `fakepi_api_${paidOrderId}` },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_api_${paidOrderId}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_api_${paidOrderId}`,
      amountMinor: c.order.totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId: paidOrderId,
    },
    systemCtx(a.org.id),
    ports,
  );
  paidTicketIds = (
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from ticketing.tickets where order_id = ${paidOrderId} order by serial`,
      ),
    )
  ).map((r) => r.id);
  readOnlyKey = (
    await executeCommand(
      createApiKeyCommand,
      { name: 'Read only', scopes: ['org:read', 'events:read', 'orders:read', 'attendees:read'] },
      a.ctx(),
      ports,
    )
  ).key;
  const viewer = await signUp('viewer', 'viewer', a);
  viewerEmail = viewer.email;
  const login = await call('POST', '/auth/login', undefined, { email: viewerEmail, password });
  viewerToken = String(login.body.token);
});
afterAll(closePools);

describe('/v1 authentication', () => {
  const orgPaths = () => [
    ['GET', `/orgs/${a.org.slug}`],
    ['GET', `/orgs/${a.org.slug}/events`],
    ['POST', `/orgs/${a.org.slug}/events`],
    ['GET', `/orgs/${a.org.slug}/events/${a.event.id}`],
    ['PATCH', `/orgs/${a.org.slug}/events/${a.event.id}`],
    ['POST', `/orgs/${a.org.slug}/events/${a.event.id}/publish`],
    ['GET', `/orgs/${a.org.slug}/events/${a.event.id}/ticket-types`],
    ['POST', `/orgs/${a.org.slug}/events/${a.event.id}/ticket-types`],
    ['GET', `/orgs/${a.org.slug}/events/${a.event.id}/orders`],
    ['GET', `/orgs/${a.org.slug}/orders/${paidOrderId}`],
    ['POST', `/orgs/${a.org.slug}/orders/${paidOrderId}/refunds`],
    ['GET', `/orgs/${a.org.slug}/events/${a.event.id}/attendees`],
    ['GET', `/orgs/${a.org.slug}/attendees/search?q=api`],
    ['POST', `/orgs/${a.org.slug}/events/${a.event.id}/checkins`],
    ['GET', '/me'],
    ['GET', '/me/organizations'],
    ['POST', '/auth/refresh'],
    ['POST', '/auth/logout'],
  ];

  it('every org, me and session endpoint needs a credential (problem+json 401)', async () => {
    for (const [method, path] of orgPaths()) {
      const r = await call(method as string, path as string, undefined, method === 'GET' ? undefined : {});
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.res.headers.get('content-type')).toBe('application/problem+json');
      expect(r.body.code).toBe('unauthenticated');
    }
  });

  it('refuses unknown keys, unknown session tokens and revoked keys with 401', async () => {
    expect((await call('GET', `/orgs/${a.org.slug}`, `yy_live_${'x'.repeat(43)}`)).status).toBe(401);
    expect((await call('GET', `/orgs/${a.org.slug}`, 'not-a-real-session-token-000')).status).toBe(401);
    const k = await executeCommand(
      createApiKeyCommand,
      { name: 'Soon gone', scopes: ['org:read'] },
      a.ctx(),
      ports,
    );
    expect((await call('GET', `/orgs/${a.org.slug}`, k.key)).status).toBe(200);
    await executeCommand(revokeApiKeyCommand, { apiKeyId: k.id }, a.ctx(), ports);
    const after = await call('GET', `/orgs/${a.org.slug}`, k.key);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('unauthenticated');
  });

  it('never takes the tenant from a header: a key only reaches its own org (404 elsewhere)', async () => {
    const other = await call('GET', `/orgs/${b.org.slug}`, a.apiKey, undefined, { 'yayatoh-org': b.org.id });
    expect(other.status).toBe(404);
    expect((await call('GET', `/orgs/${b.org.id}/events`, a.apiKey)).status).toBe(404);
    // Another org's event id through the key's own org is simply not found (RLS).
    expect((await call('GET', `/orgs/${a.org.slug}/events/${b.event.id}`, a.apiKey)).status).toBe(404);
    expect((await call('GET', `/orgs/${a.org.slug}/orders/${paidOrderId}`, b.apiKey)).status).toBe(404);
    // By id or by slug alike.
    expect((await call('GET', `/orgs/${a.org.id}`, a.apiKey)).body.slug).toBe(a.org.slug);
  });

  it('a read-only key cannot write (403) and does not need write scopes to read', async () => {
    expect((await call('GET', `/orgs/${a.org.slug}/events`, readOnlyKey)).status).toBe(200);
    for (const [method, path, body] of [
      [
        'POST',
        `/orgs/${a.org.slug}/events`,
        { name: 'Nope', timezone: 'UTC', startsAt: '2029-01-01T10:00:00Z', endsAt: '2029-01-01T11:00:00Z' },
      ],
      ['PATCH', `/orgs/${a.org.slug}/events/${draftId}`, { name: 'Nope' }],
      ['POST', `/orgs/${a.org.slug}/events/${draftId}/publish`, undefined],
      [
        'POST',
        `/orgs/${a.org.slug}/orders/${paidOrderId}/refunds`,
        { reason: 'requested_by_customer', amountMinor: 100 },
      ],
      ['POST', `/orgs/${a.org.slug}/events/${a.event.id}/checkins`, { code: 'NOPE' }],
    ] as const) {
      const r = await call(method, path, readOnlyKey, body, idem());
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.code).toBe('forbidden');
    }
  });

  it('echoes a request id, mints one otherwise, and sends RateLimit headers', async () => {
    const mine = await call('GET', `/orgs/${a.org.slug}`, a.apiKey, undefined, {
      'x-request-id': 'client-req-12345',
    });
    expect(mine.res.headers.get('x-request-id')).toBe('client-req-12345');
    const minted = await call('GET', `/orgs/${a.org.slug}`, a.apiKey);
    expect(minted.res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(minted.res.headers.get('ratelimit-limit')).toBe('600');
    expect(Number(minted.res.headers.get('ratelimit-remaining'))).toBeLessThan(600);
  });

  it('rate limits per key with 429 problem+json and Retry-After; another key is unaffected', async () => {
    const now = Date.now();
    const limited = mount({ rateLimiter: memoryRateLimiter({ clock: () => now }) });
    const hit = (key: string) => limited.request(`/v1/orgs/${a.org.slug}`, { headers: bearer(key) });
    let last: Response | undefined;
    for (let i = 0; i < 601; i++) last = await hit(readOnlyKey);
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(((await (last as Response).json()) as Json).code).toBe('rate_limited');
    expect((await hit(a.apiKey)).status).toBe(200);
  });
});

describe('/v1 resources with an org API key', () => {
  it('reads the organization through an allowlist', async () => {
    const r = await call('GET', `/orgs/${a.org.slug}`, a.apiKey);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(
      ['country', 'currency', 'defaultLocale', 'id', 'name', 'slug', 'timezone'].sort(),
    );
  });

  it('pages events with an opaque cursor (no duplicates, no gaps)', async () => {
    const all: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = cursor ? `&cursor=${cursor}` : '';
      const r = await call('GET', `/orgs/${a.org.slug}/events?limit=1${qs}`, a.apiKey);
      expect(r.status).toBe(200);
      const data = r.body.data as { id: string; startsAt: string }[];
      expect(data.length).toBeLessThanOrEqual(1);
      all.push(...data.map((e) => e.id));
      cursor = r.body.nextCursor as string | null;
      pages++;
    } while (cursor && pages < 50);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expect.arrayContaining([a.event.id, draftId]));
    const bad = await call('GET', `/orgs/${a.org.slug}/events?cursor=garbage`, a.apiKey);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('validation_failed');
    expect((await call('GET', `/orgs/${a.org.slug}/events?limit=101`, a.apiKey)).status).toBe(400);
  });

  it('creates an event once per Idempotency-Key: a retry replays, a different body is 422', async () => {
    const body = {
      name: `API event ${suffix}`,
      timezone: 'America/Chicago',
      startsAt: '2029-09-01T23:00:00Z',
      endsAt: '2029-09-02T03:00:00Z',
    };
    const missing = await call('POST', `/orgs/${a.org.slug}/events`, a.apiKey, body);
    expect(missing.status).toBe(400);
    const key = idem();
    const first = await call('POST', `/orgs/${a.org.slug}/events`, a.apiKey, body, key);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'draft', name: body.name, timezone: 'America/Chicago' });
    const again = await call('POST', `/orgs/${a.org.slug}/events`, a.apiKey, body, key);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    const mismatch = await call(
      'POST',
      `/orgs/${a.org.slug}/events`,
      a.apiKey,
      { ...body, name: 'Other' },
      key,
    );
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.code).toBe('idempotency_key_reused');
    const invalid = await call(
      'POST',
      `/orgs/${a.org.slug}/events`,
      a.apiKey,
      { ...body, endsAt: body.startsAt },
      idem(),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('validation_failed');
  });

  it('updates, adds a ticket type, lists and changes it, then publishes', async () => {
    const path = `/orgs/${a.org.slug}/events/${draftId}`;
    const up = await call('PATCH', path, a.apiKey, { tagline: 'Now with an API' }, idem());
    expect(up.status).toBe(200);
    expect(up.body.tagline).toBe('Now with an API');
    const tt = await call(
      'POST',
      `${path}/ticket-types`,
      a.apiKey,
      { name: 'API GA', priceMinor: 2500, quantityTotal: 50 },
      idem(),
    );
    expect(tt.status).toBe(201);
    expect(tt.body).toMatchObject({ name: 'API GA', priceMinor: 2500, currency: 'USD', quantitySold: 0 });
    const list = await call('GET', `${path}/ticket-types`, a.apiKey);
    expect((list.body.data as Json[]).map((t) => t.id)).toContain(tt.body.id);
    const changed = await call(
      'PATCH',
      `/orgs/${a.org.slug}/ticket-types/${tt.body.id}`,
      a.apiKey,
      { quantityTotal: 60 },
      idem(),
    );
    expect(changed.body.quantityTotal).toBe(60);
    const pub = await call('POST', `${path}/publish`, a.apiKey, undefined, idem());
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');
    const twice = await call('POST', `${path}/publish`, a.apiKey, undefined, idem());
    expect(twice.status).toBe(409);
    // Foreign event → 404, not an empty list.
    expect(
      (await call('GET', `/orgs/${a.org.slug}/events/${b.event.id}/ticket-types`, a.apiKey)).status,
    ).toBe(404);
  });

  it('lists and reads orders without internal payment fields', async () => {
    const order = await call('GET', `/orgs/${a.org.slug}/orders/${paidOrderId}`, a.apiKey);
    expect(order.status).toBe(200);
    expect(order.body).toMatchObject({ id: paidOrderId, status: 'paid', buyerName: 'Api Buyer' });
    expect((order.body.tickets as Json[]).length).toBe(2);
    for (const leak of ['fundsFlow', 'paymentReference', 'collectedBy', 'expiresAt', 'orgId'])
      expect(order.body).not.toHaveProperty(leak);
    const eventId = (order.body as { eventId: string }).eventId;
    const list = await call('GET', `/orgs/${a.org.slug}/events/${eventId}/orders?limit=10`, a.apiKey);
    expect((list.body.data as Json[]).map((o) => o.id)).toContain(paidOrderId);
    expect(list.body.nextCursor).toBeNull();
  });

  it('refunds a ticket (201), replays the same Idempotency-Key without a second refund', async () => {
    const key = idem();
    const body = { reason: 'requested_by_customer', ticketIds: [paidTicketIds[0]] };
    const r = await call('POST', `/orgs/${a.org.slug}/orders/${paidOrderId}/refunds`, a.apiKey, body, key);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'succeeded', amountMinor: 4000, currency: 'USD' });
    const again = await call(
      'POST',
      `/orgs/${a.org.slug}/orders/${paidOrderId}/refunds`,
      a.apiKey,
      body,
      key,
    );
    expect(again.status).toBe(201);
    expect(again.body.refundId).toBe(r.body.refundId);
    const [{ n }] = (await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from orders.refunds where order_id = ${paidOrderId}`,
      ),
    )) as unknown as [{ n: number }];
    expect(n).toBe(1);
    const order = await call('GET', `/orgs/${a.org.slug}/orders/${paidOrderId}`, a.apiKey);
    expect(order.body.status).toBe('partially_refunded');
  });

  it('lists, pages, filters, reads and searches attendees', async () => {
    const first = await call('GET', `/orgs/${a.org.slug}/events/${a.event.id}/attendees?limit=1`, a.apiKey);
    expect(first.status).toBe(200);
    const data = first.body.data as { id: string }[];
    expect(data).toHaveLength(1);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await call(
      'GET',
      `/orgs/${a.org.slug}/events/${a.event.id}/attendees?limit=1&cursor=${first.body.nextCursor}`,
      a.apiKey,
    );
    expect((second.body.data as { id: string }[])[0]?.id).not.toBe(data[0]?.id);
    const one = await call(
      'GET',
      `/orgs/${a.org.slug}/events/${a.event.id}/attendees/${data[0]?.id}`,
      a.apiKey,
    );
    expect(one.status).toBe(200);
    expect(Object.keys(one.body).sort()).toEqual(
      ['createdAt', 'email', 'eventId', 'id', 'labels', 'name', 'source', 'status', 'ticketId'].sort(),
    );
    const found = await call(
      'GET',
      `/orgs/${a.org.slug}/attendees/search?q=${encodeURIComponent(String(one.body.name).slice(0, 4))}`,
      a.apiKey,
    );
    expect(found.status).toBe(200);
    expect((found.body.data as Json[]).length).toBeGreaterThan(0);
    // Another org's key sees none of it.
    expect((await call('GET', `/orgs/${a.org.slug}/events/${a.event.id}/attendees`, b.apiKey)).status).toBe(
      404,
    );
  });

  it('scans online with the check-in engine: invalid code, and a retry returns the first verdict', async () => {
    const key = idem();
    const r = await call(
      'POST',
      `/orgs/${a.org.slug}/events/${a.event.id}/checkins`,
      a.apiKey,
      { code: 'NOTACODE' },
      key,
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ result: 'invalid', ticket: null });
    const again = await call(
      'POST',
      `/orgs/${a.org.slug}/events/${a.event.id}/checkins`,
      a.apiKey,
      { code: 'NOTACODE' },
      key,
    );
    expect(again.body).toEqual(r.body);
  });
});

describe('/v1 device check-in', () => {
  it('scans with a device token; the org comes from the token', async () => {
    const { token } = await executeCommand(enrollDeviceCommand, { label: 'API door' }, a.ctx(), ports);
    const post = (eventId: string, key = idem()) =>
      call('POST', '/checkins', token, { eventId, code: 'NOTACODE' }, key);
    const r = await post(a.event.id);
    expect(r.status).toBe(200);
    expect(r.body.result).toBe('invalid');
    expect((await post(b.event.id)).status).toBe(404);
    const noKey = await call('POST', '/checkins', token, { eventId: a.event.id, code: 'X' });
    expect(noKey.status).toBe(400);
    expect(
      (await call('POST', '/checkins', undefined, { eventId: a.event.id, code: 'X' }, idem())).status,
    ).toBe(401);
  });
});

describe('/v1 user sessions (bearer)', () => {
  it('logs in without cookies and reads me and my organizations', async () => {
    const login = await call('POST', '/auth/login', undefined, { email: viewerEmail, password });
    expect(login.status).toBe(200);
    expect(login.res.headers.get('set-cookie')).toBeNull();
    expect(login.body).toMatchObject({ tokenType: 'bearer', user: { email: viewerEmail } });
    const me = await call('GET', '/me', viewerToken);
    expect(me.body.email).toBe(viewerEmail);
    const orgs = await call('GET', '/me/organizations', viewerToken);
    expect(orgs.body.data).toEqual([{ id: a.org.id, slug: a.org.slug, name: a.org.name, role: 'viewer' }]);
  });

  it('refuses a wrong password (401) without saying whether the account exists', async () => {
    const wrong = await call('POST', '/auth/login', undefined, {
      email: viewerEmail,
      password: 'nope-nope-nope',
    });
    const unknown = await call('POST', '/auth/login', undefined, {
      email: `ghost-${suffix}@example.test`,
      password,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.detail).toBe(unknown.body.detail);
  });

  it('a member reads by role; a viewer cannot write; a non-member gets 404', async () => {
    expect((await call('GET', `/orgs/${a.org.slug}/events`, viewerToken)).status).toBe(200);
    const write = await call(
      'PATCH',
      `/orgs/${a.org.slug}/events/${a.event.id}`,
      viewerToken,
      { name: 'Viewer edit' },
      idem(),
    );
    expect(write.status).toBe(403);
    expect((await call('GET', `/orgs/${b.org.slug}`, viewerToken)).status).toBe(404);
  });

  it('a manager session writes; refresh keeps the token; logout ends it at once', async () => {
    const m = await signUp('manager', 'manager', a);
    const login = await call('POST', '/auth/login', undefined, { email: m.email, password });
    const token = String(login.body.token);
    const created = await call(
      'POST',
      `/orgs/${a.org.slug}/events`,
      token,
      {
        name: `Manager event ${suffix}`,
        timezone: 'UTC',
        startsAt: '2029-10-01T10:00:00Z',
        endsAt: '2029-10-01T12:00:00Z',
      },
      idem(),
    );
    expect(created.status).toBe(201);
    const refreshed = await call('POST', '/auth/refresh', token);
    expect(refreshed.body.token).toBe(token);
    expect(Date.parse(String(refreshed.body.expiresAt))).toBeGreaterThan(Date.now());
    expect((await call('POST', '/auth/logout', token)).status).toBe(204);
    expect((await call('GET', '/me', token)).status).toBe(401);
  });

  it('an API key is not a user session for /me', async () => {
    expect((await call('GET', '/me', a.apiKey)).status).toBe(401);
  });

  it('limits sign-in attempts per account (5 per 15 min) with 429', async () => {
    const x = await signUp('limited', null, a);
    let last = 0;
    for (let i = 0; i < 6; i++)
      last = (await call('POST', '/auth/login', undefined, { email: x.email, password: 'wrong-password' }))
        .status;
    expect(last).toBe(429);
  });
});

describe('/v1 public and mobile', () => {
  it('serves a published event and its passes to anyone; drafts are 404', async () => {
    const pub = await call('GET', `/public/events/${a.event.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ slug: a.event.slug, organizerName: 'Alpha Events' });
    expect(pub.body).not.toHaveProperty('id');
    const types = await call('GET', `/public/events/${a.event.slug}/ticket-types`);
    expect(types.status).toBe(200);
    for (const t of types.body.data as Json[]) {
      expect(t).not.toHaveProperty('quantitySold');
      expect(t).toHaveProperty('availability');
    }
    const draft = await executeCommand(
      createEventCommand,
      {
        name: `Hidden ${suffix}`,
        timezone: 'UTC',
        startsAt: '2029-01-01T10:00:00Z',
        endsAt: '2029-01-01T11:00:00Z',
      },
      a.ctx(),
      ports,
    );
    expect((await call('GET', `/public/events/${draft.slug}`)).status).toBe(404);
    expect((await call('GET', `/public/events/${draft.slug}/ticket-types`)).status).toBe(404);
  });

  it('serves the mobile config without a credential', async () => {
    const r = await call('GET', '/mobile/config');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      apiVersion: expect.any(String),
      minimumVersions: { ios: expect.any(String) },
    });
  });

  it('serves the OpenAPI document and the Scalar reference', async () => {
    const doc = await call('GET', '/openapi.json');
    expect(doc.status).toBe(200);
    expect(Object.keys(doc.body.paths as Json)).toContain('/v1/orgs/{org}/events');
    const docs = await app.request('/v1/docs');
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain('/v1/openapi.json');
    const js = await app.request('/v1/docs/scalar.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
  });
});

describe('/v1 app-version telemetry', () => {
  it('counts requests per route × client × version, with no tenant data', async () => {
    const tapp = mount({ telemetry: true });
    const version = `9.${randomBytes(2).readUInt16BE()}.0`;
    for (let i = 0; i < 3; i++)
      await tapp.request('/v1/mobile/config', { headers: { 'x-yayatoh-client': `ios/${version}` } });
    const sqlc = adminClient();
    let rows: { route: string; client: string; count: number }[] = [];
    for (let i = 0; i < 40 && rows[0]?.count !== 3; i++) {
      await new Promise((r) => setTimeout(r, 50));
      rows = await sqlc<{ route: string; client: string; count: number }[]>`
        select route, client, count::int as count from platform.api_usage where app_version = ${version}`;
    }
    await sqlc.end();
    expect(rows).toEqual([{ route: '/mobile/config', client: 'ios', count: 3 }]);
  });
});
