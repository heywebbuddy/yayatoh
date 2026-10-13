import { randomBytes } from 'node:crypto';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { enrollDeviceCommand, setDeviceStateCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { addMemberCommand } from '@yayatoh/tenancy';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, type V1Deps } from '../src/index.ts';
import { staffOverviewFor } from '../src/staff/index.ts';

/**
 * M7.2e: the Staff app's device-token routes (`/v1/staff/*`), the organizer's event-day view
 * (`/v1/orgs/{org}/events/{event}/ops`), and the contract with the Scan PWA's `/api/scan/*`
 * handlers (one implementation behind both).
 */
const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const deps: V1Deps = {
  ports,
  sessions: () => bearerSessions(auth),
  payments: () => payments,
  telemetry: false,
};
const app = new Hono();
app.route('/v1', createV1(deps));

let a: OrgFixture;
let b: OrgFixture;
const password = 'correct horse battery';
const suffix = randomBytes(4).toString('hex');

type Json = Record<string, unknown>;
async function call(method: string, path: string, token?: string, bodyJson?: unknown) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(bodyJson !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
  });
  const text = await res.text();
  return { res, status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

async function enroll(label: string, org = a) {
  const { token, deviceId } = await executeCommand(enrollDeviceCommand, { label }, org.ctx(), ports);
  return { token, deviceId };
}

async function memberToken(name: string, role: 'viewer' | 'manager', org: OrgFixture) {
  const email = `${name}-${suffix}@example.test`;
  const r = await auth.api.signUpEmail({ body: { email, password, name } });
  await executeCommand(addMemberCommand, { userId: r.user.id, role }, org.ctx(), ports);
  const login = await call('POST', '/auth/login', undefined, { email, password });
  return String(login.body.token);
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const ARRIVAL = (guestId: string) => ({
  clientId: crypto.randomUUID(),
  guestId,
  deviceTs: new Date().toISOString(),
  clockOffsetMs: 0,
  source: 'scanner',
});

/** Every `/staff` route, with a body where it takes one. */
const staffCalls = () =>
  [
    ['GET', `/staff/events/${a.event.id}/overview`, undefined],
    ['GET', `/staff/events/${a.event.id}/guests`, undefined],
    ['POST', '/staff/guest-arrivals', { eventId: a.event.id, arrivals: [ARRIVAL(crypto.randomUUID())] }],
    ['GET', `/staff/events/${a.event.id}/assistance`, undefined],
    ['POST', '/staff/assistance', { eventId: a.event.id, reason: 'backup' }],
    ['POST', `/staff/assistance/${crypto.randomUUID()}/take`, { eventId: a.event.id }],
    ['GET', '/staff/push', undefined],
    [
      'PUT',
      '/staff/push',
      {
        platform: 'fcm',
        token: 'fcm-token-0123456789',
        locale: 'en',
        copy: Object.fromEntries(
          ['device_offline', 'device_low_battery', 'device_backlog', 'capacity_near'].map((k) => [
            k,
            { title: 'Alert', body: 'Alert body' },
          ]),
        ),
      },
    ],
    ['DELETE', '/staff/push', undefined],
  ] as const;

describe('/v1/staff device authentication', () => {
  it('every route needs a device token (problem+json 401), and rejects other credentials', async () => {
    const key = a.apiKey;
    for (const [method, path, body] of staffCalls()) {
      const none = await call(method, path, undefined, body);
      expect(none.status, `${method} ${path}`).toBe(401);
      expect(none.res.headers.get('content-type')).toBe('application/problem+json');
      expect((await call(method, path, `yyd_${'x'.repeat(43)}`, body)).status, `${method} ${path}`).toBe(401);
      expect((await call(method, path, key, body)).status, `${method} ${path} (api key)`).toBe(401);
    }
  });

  it('a revoked device gets 401 on every route, at once', async () => {
    const d = await enroll('To revoke');
    const ok = await call('GET', `/staff/events/${a.event.id}/overview`, d.token);
    expect(ok.status).toBe(200);
    await executeCommand(setDeviceStateCommand, { deviceId: d.deviceId, action: 'revoke' }, a.ctx(), ports);
    for (const [method, path, body] of staffCalls()) {
      const r = await call(method, path, d.token, body);
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.body.code).toBe('unauthenticated');
    }
  });

  it('a wiped device gets 401 on every route, at once', async () => {
    const d = await enroll('To wipe');
    expect((await call('GET', '/staff/push', d.token)).status).toBe(200);
    await executeCommand(setDeviceStateCommand, { deviceId: d.deviceId, action: 'wipe' }, a.ctx(), ports);
    for (const [method, path, body] of staffCalls()) {
      const r = await call(method, path, d.token, body);
      expect(r.status, `${method} ${path}`).toBe(401);
    }
  });

  it('the token decides the org: another org’s event is not found', async () => {
    const d = await enroll('Org A door');
    expect((await call('GET', `/staff/events/${b.event.id}/overview`, d.token)).status).toBe(404);
    expect((await call('GET', `/staff/events/${b.event.id}/guests`, d.token)).status).toBe(404);
    expect((await call('GET', `/staff/events/${b.event.id}/assistance`, d.token)).status).toBe(404);
  });
});

describe('/v1/staff reads', () => {
  it('the overview is exactly what the Scan PWA’s staff route answers (one implementation)', async () => {
    const d = await enroll('Door overview');
    const r = await call('GET', `/staff/events/${a.event.id}/overview`, d.token);
    expect(r.status).toBe(200);
    const direct = await staffOverviewFor(
      (await import('@yayatoh/checkin').then((m) => m.deviceContext(d.token)))?.ctx as never,
      a.event.id,
      ports,
    );
    expect(r.body.deviceId).toBe(d.deviceId);
    expect(r.body.eventId).toBe(a.event.id);
    expect(r.body.checkedIn).toBe(direct.checkedIn);
    expect(r.body.expected).toBe(direct.expected);
    expect(r.body.channels).toEqual(direct.channels);
    expect((r.body.devices as Json[]).every((x) => typeof x.self === 'boolean')).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/orgId|org_id|tokenHash|token_hash/);
  });

  it('answers the guest snapshot as an allowlist and records arrivals idempotently', async () => {
    const d = await enroll('Door guests');
    const snap = await call('GET', `/staff/events/${a.event.id}/guests`, d.token);
    expect(snap.status).toBe(200);
    expect(snap.body).toMatchObject({ eventId: a.event.id, parties: expect.any(Array) });
    expect(JSON.stringify(snap.body)).not.toMatch(/email|phone|orgId/);
    const unknownGuest = crypto.randomUUID();
    const arrival = ARRIVAL(unknownGuest);
    const first = await call('POST', '/staff/guest-arrivals', d.token, {
      eventId: a.event.id,
      arrivals: [arrival],
    });
    expect(first.status).toBe(200);
    expect(first.body.results).toEqual([{ clientId: arrival.clientId, result: 'unknown' }]);
    const again = await call('POST', '/staff/guest-arrivals', d.token, {
      eventId: a.event.id,
      arrivals: [arrival],
    });
    expect(again.body).toEqual(first.body);
    const empty = await call('POST', '/staff/guest-arrivals', d.token, { eventId: a.event.id, arrivals: [] });
    expect(empty.status).toBe(400);
  });
});

describe('/v1/staff help requests', () => {
  it('raises, lists, takes, starts and resolves a request; a closed one cannot be worked', async () => {
    const d = await enroll('Door help');
    const note = `Need backup ${suffix}`;
    const created = await call('POST', '/staff/assistance', d.token, {
      eventId: a.event.id,
      reason: 'backup',
      note,
    });
    expect(created.status).toBe(201);
    const id = String(created.body.requestId);
    const list = await call('GET', `/staff/events/${a.event.id}/assistance`, d.token);
    expect(list.status).toBe(200);
    const mine = (list.body.requests as Json[]).find((x) => x.id === id);
    expect(mine).toMatchObject({ source: 'staff', reason: 'backup', note, mine: false });
    const work = (action: string) =>
      call('POST', `/staff/assistance/${id}/${action}`, d.token, { eventId: a.event.id });
    const taken = await work('take');
    expect(taken.status).toBe(200);
    expect(taken.body.state).toBe('assigned');
    const relist = await call('GET', `/staff/events/${a.event.id}/assistance`, d.token);
    expect((relist.body.requests as Json[]).find((x) => x.id === id)).toMatchObject({ mine: true });
    expect((await work('start')).body.state).toBe('in_progress');
    expect((await work('resolve')).body.state).toBe('resolved');
    const closed = await work('cancel');
    expect(closed.status).toBe(409);
    const gone = await call('GET', `/staff/events/${a.event.id}/assistance`, d.token);
    expect((gone.body.requests as Json[]).some((x) => x.id === id)).toBe(false);
  });

  it('validates the body and refuses an unknown reason, an unknown request and another org’s event', async () => {
    const d = await enroll('Door help invalid');
    expect(
      (await call('POST', '/staff/assistance', d.token, { eventId: a.event.id, reason: 'pizza' })).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/staff/assistance', d.token, {
          eventId: a.event.id,
          reason: 'backup',
          note: 'x'.repeat(501),
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('POST', `/staff/assistance/${crypto.randomUUID()}/take`, d.token, { eventId: a.event.id }))
        .status,
    ).toBe(404);
    expect(
      (
        await call('POST', `/staff/assistance/${crypto.randomUUID()}/explode`, d.token, {
          eventId: a.event.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('POST', '/staff/assistance', d.token, { eventId: b.event.id, reason: 'backup' })).status,
    ).toBe(404);
  });
});

describe('/v1/staff push registration', () => {
  const copy = Object.fromEntries(
    ['device_offline', 'device_low_battery', 'device_backlog', 'capacity_near'].map((k) => [
      k,
      { title: `T ${k}`, body: `B ${k}` },
    ]),
  );
  const rows = (deviceId: string) =>
    withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ platform: string; endpoint: string; app_id: string | null }>(
        sql`select platform, endpoint, app_id from checkin.staff_push_subscriptions where device_id = ${deviceId}`,
      ),
    );

  it('registers APNs or FCM for the device, replaces it, and removes it', async () => {
    const d = await enroll('Door push');
    expect((await call('GET', '/staff/push', d.token)).body).toEqual({
      subscribed: false,
      supervisor: false,
      platform: null,
    });
    const put = await call('PUT', '/staff/push', d.token, {
      platform: 'apns',
      token: 'a'.repeat(64),
      appId: 'agency.yayatoh.staff',
      locale: 'fr',
      copy,
    });
    expect(put.status).toBe(200);
    expect((await call('GET', '/staff/push', d.token)).body).toMatchObject({
      subscribed: true,
      platform: 'apns',
    });
    expect([...(await rows(d.deviceId))]).toHaveLength(1);
    const replaced = await call('PUT', '/staff/push', d.token, {
      platform: 'fcm',
      token: 'fcm:registration-token-1',
      locale: 'en',
      copy,
    });
    expect(replaced.status).toBe(200);
    const [row, ...rest] = [...(await rows(d.deviceId))];
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ platform: 'fcm', endpoint: 'fcm:registration-token-1', app_id: null });
    expect((await call('DELETE', '/staff/push', d.token)).status).toBe(200);
    expect([...(await rows(d.deviceId))]).toHaveLength(0);
    expect((await call('GET', '/staff/push', d.token)).body.subscribed).toBe(false);
  });

  it('refuses a bad token, platform or text; the token never comes back', async () => {
    const d = await enroll('Door push invalid');
    const bad = (extra: Json) =>
      call('PUT', '/staff/push', d.token, {
        platform: 'fcm',
        token: 'fcm-token-ok-1',
        locale: 'en',
        copy,
        ...extra,
      });
    expect((await bad({ platform: 'webpush' })).status).toBe(400);
    expect((await bad({ token: 'short' })).status).toBe(400);
    expect((await bad({ locale: 'English' })).status).toBe(400);
    expect((await bad({ copy: {} })).status).toBe(400);
    expect((await bad({ token: 'has space in it' })).status).toBe(400);
    expect((await bad({})).status).toBe(200);
    expect(JSON.stringify((await call('GET', '/staff/push', d.token)).body)).not.toContain('fcm-token-ok-1');
  });

  it('revoking or wiping the device deletes its registration', async () => {
    const revoked = await enroll('Door push revoke');
    const wiped = await enroll('Door push wipe');
    for (const d of [revoked, wiped])
      expect(
        (
          await call('PUT', '/staff/push', d.token, {
            platform: 'fcm',
            token: `fcm-${d.deviceId}`,
            locale: 'en',
            copy,
          })
        ).status,
      ).toBe(200);
    await executeCommand(
      setDeviceStateCommand,
      { deviceId: revoked.deviceId, action: 'revoke' },
      a.ctx(),
      ports,
    );
    await executeCommand(setDeviceStateCommand, { deviceId: wiped.deviceId, action: 'wipe' }, a.ctx(), ports);
    expect([...(await rows(revoked.deviceId))]).toHaveLength(0);
    expect([...(await rows(wiped.deviceId))]).toHaveLength(0);
  });
});

describe('GET /v1/orgs/{org}/events/{event}/ops', () => {
  it('needs a signed-in member who can read the event; another org’s member gets 404', async () => {
    const path = `/orgs/${a.org.slug}/events/${a.event.id}/ops`;
    expect((await call('GET', path)).status).toBe(401);
    const manager = await memberToken('ops-manager', 'manager', a);
    const r = await call('GET', path, manager);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ eventId: a.event.id });
    const outsider = await memberToken('ops-outsider', 'manager', b);
    expect((await call('GET', path, outsider)).status).toBe(404);
    expect((await call('GET', `/orgs/${a.org.slug}/events/${crypto.randomUUID()}/ops`, manager)).status).toBe(
      404,
    );
  });

  it('answers the web Command Center’s numbers, and no device token works here', async () => {
    const manager = await memberToken('ops-numbers', 'manager', a);
    const r = await call('GET', `/orgs/${a.org.slug}/events/${a.event.id}/ops`, manager);
    expect(r.status).toBe(200);
    const { entrancesWidget, deviceBoardWidget, scanIssuesWidget, eventViewQuery } = await import(
      '@yayatoh/command-center'
    );
    const ctx = a.ctx();
    const load = (def: { loader: never }) =>
      executeQuery(def.loader, { eventId: a.event.id, params: {} } as never, ctx, ports);
    const [entrances, devices, issues, view] = await Promise.all([
      load(entrancesWidget as never),
      load(deviceBoardWidget as never),
      load(scanIssuesWidget as never),
      executeQuery(eventViewQuery, { eventId: a.event.id }, ctx, ports),
    ]);
    const ops = r.body as Record<string, Json | null>;
    expect(ops.mode).toBe(view.mode.mode);
    const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'asOf' ? undefined : x)));
    expect(strip(ops.checkins)).toEqual(strip(entrances));
    expect(strip(ops.devices)).toEqual(strip(devices));
    expect(strip(ops.scanIssues)).toEqual(strip(issues));
    const d = await enroll('Door ops');
    const device = await call('GET', `/orgs/${a.org.slug}/events/${a.event.id}/ops`, d.token);
    expect(device.status).toBe(401);
    const key = await call('GET', `/orgs/${a.org.slug}/events/${a.event.id}/ops`, a.apiKey);
    expect(key.status).toBe(403);
    expect(key.body.code).toBe('forbidden');
  });
});
