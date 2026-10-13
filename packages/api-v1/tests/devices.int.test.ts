import { randomBytes } from 'node:crypto';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { fakePaymentProvider } from '@yayatoh/payments';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1 } from '../src/index.ts';

// POST/DELETE /v1/me/devices (M7.2c): behind the /me scope, keyed by the session's verified email.
const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const sessions = bearerSessions(auth);
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const app = new Hono().route(
  '/v1',
  createV1({ ports, sessions: () => sessions, payments: () => payments, telemetry: false }),
);
const admin = adminClient();
const password = 'correct horse battery';
const suffix = randomBytes(4).toString('hex');
let a: OrgFixture;
let b: OrgFixture;

type Json = Record<string, unknown>;
async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

async function person(name: string, verified = true) {
  const email = `${name}-${suffix}@example.test`;
  const r = await auth.api.signUpEmail({ body: { email, password, name } });
  await admin`update auth.users set email_verified = ${verified} where id = ${r.user.id}`;
  const login = await call('POST', '/auth/login', undefined, { email, password });
  return { email, token: String(login.body.token) };
}

async function ticketFor(org: OrgFixture, email: string) {
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Devices ${uuidv7().slice(-6)}`,
      timezone: 'Europe/Lisbon',
      startsAt: '2030-06-01T23:00:00Z',
      endsAt: '2030-06-02T03:00:00Z',
    },
    org.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: ev.id, name: 'Free', priceMinor: 0, quantityTotal: 10 },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
  await executeCommand(
    startCheckoutCommand,
    { eventId: ev.id, items: [{ ticketTypeId: tt.id, quantity: 1 }], buyer: { email, name: 'Rae Buyer' } },
    createCtx({ orgId: org.org.id }),
    ports,
  );
}

const device = (over: Json = {}) => ({
  platform: 'apns',
  token: randomBytes(32).toString('hex'),
  appId: 'com.yayatoh.app',
  appVersion: '1.2.0',
  locale: 'pt-BR',
  timeZone: 'Europe/Lisbon',
  environment: 'sandbox',
  ...over,
});
const rowsOf = (org: OrgFixture, token: string) =>
  withTenant(systemCtx(org.org.id), (tx) =>
    tx.execute<{ email_norm: string; locale: string; environment: string; source: string }>(
      sql`select email_norm, locale, environment, source from notifications.push_tokens where token = ${token}`,
    ),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('POST /v1/me/devices', () => {
  it('needs a signed-in person with a verified email; an API key is not a person', async () => {
    const d = device();
    expect((await call('POST', '/me/devices', undefined, d)).status).toBe(401);
    expect((await call('POST', '/me/devices', a.apiKey, d)).status).toBe(401);
    const unverified = await person('unverified', false);
    const r = await call('POST', '/me/devices', unverified.token, d);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'forbidden', details: { reason: 'email_unverified' } });
    expect((await call('DELETE', `/me/devices/${d.token}`, unverified.token)).status).toBe(403);
  });

  it('rejects a malformed request with the fields named', async () => {
    const p = await person('invalid');
    for (const bad of [
      device({ platform: 'webpush' }),
      device({ token: 'zz' }),
      device({ token: 'not-hex-not-hex-not-hex-not-hex!' }),
      device({ platform: 'fcm', token: 'short' }),
      device({ appId: '' }),
      device({ appVersion: 'v 1' }),
      device({ locale: 'not a locale' }),
      device({ environment: 'staging' }),
    ]) {
      const r = await call('POST', '/me/devices', p.token, bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.code).toBe('validation_failed');
    }
    expect((await call('POST', '/me/devices', p.token, { ...device(), extra: 1 })).status).toBe(200);
  });

  it('stores the phone where the person has an order and nowhere else; again is harmless', async () => {
    const p = await person('holder');
    const d = device();
    // Nothing bought yet: nowhere to store it. The app registers again after the first purchase.
    expect(await call('POST', '/me/devices', p.token, d)).toMatchObject({
      status: 200,
      body: { organizations: 0 },
    });
    await ticketFor(a, p.email);
    expect(await call('POST', '/me/devices', p.token, d)).toMatchObject({
      status: 200,
      body: { organizations: 1 },
    });
    expect(await rowsOf(a, d.token)).toEqual([
      { email_norm: p.email, locale: 'pt-BR', environment: 'sandbox', source: 'app' },
    ]);
    expect(await rowsOf(b, d.token)).toEqual([]);
    await call('POST', '/me/devices', p.token, d);
    expect(await rowsOf(a, d.token)).toHaveLength(1);
    // A second org later: registering again reaches it too.
    await ticketFor(b, p.email);
    expect((await call('POST', '/me/devices', p.token, d)).body).toEqual({ organizations: 2 });
  });

  it('another person signing in on the phone takes it over: the previous owner stops receiving', async () => {
    const first = await person('first');
    const second = await person('second');
    await ticketFor(a, first.email);
    await ticketFor(a, second.email);
    const d = device();
    await call('POST', '/me/devices', first.token, d);
    await call('POST', '/me/devices', second.token, d);
    expect((await rowsOf(a, d.token)).map((r) => r.email_norm)).toEqual([second.email]);
  });
});

describe('DELETE /v1/me/devices/{token}', () => {
  it('removes the person’s own rows in every org; unknown or someone else’s token answer 204 and change nothing', async () => {
    const mine = await person('signout');
    const theirs = await person('neighbour');
    await ticketFor(a, mine.email);
    await ticketFor(b, mine.email);
    await ticketFor(a, theirs.email);
    const d = device();
    const e = device();
    await call('POST', '/me/devices', mine.token, d);
    await call('POST', '/me/devices', theirs.token, e);
    expect((await call('DELETE', `/me/devices/${e.token}`, mine.token)).status).toBe(204);
    expect(await rowsOf(a, e.token)).toHaveLength(1);
    expect((await call('DELETE', `/me/devices/${d.token}`, mine.token)).status).toBe(204);
    expect(await rowsOf(a, d.token)).toEqual([]);
    expect(await rowsOf(b, d.token)).toEqual([]);
    expect((await call('DELETE', `/me/devices/${d.token}`, mine.token)).status).toBe(204);
    expect((await call('DELETE', `/me/devices/${d.token}`, undefined)).status).toBe(401);
  });
});
