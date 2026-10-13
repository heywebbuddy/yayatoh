import { randomBytes } from 'node:crypto';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { executeCommand, STEP_UP_WINDOW_MS } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { addMemberCommand, createApiKeyCommand } from '@yayatoh/tenancy';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, type V1Env } from '../src/index.ts';

// The `/me` scope and step-up reaching commands (M7.2a). Probe routes are mounted on the router the
// way later increments mount theirs, so the middleware is tested where it runs.
const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const sessions = bearerSessions(auth);
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });

const v1 = createV1({ ports, sessions: () => sessions, payments: () => payments, telemetry: false });
v1.get('/me/probe', (c) => {
  const me = (c as unknown as { get(k: 'me'): V1Env['Variables']['me'] }).get('me');
  return c.json({
    userId: me.user.id,
    orgId: me.ctx.orgId,
    actor: me.ctx.actor,
    stepUp: me.ctx.stepUpAt?.toISOString() ?? null,
  });
});
/** A command marked `stepUp` run with the request's ctx, as a route would. */
v1.post('/orgs/:org/probe-step-up', async (c) => {
  const key = await executeCommand(
    createApiKeyCommand,
    { name: `probe-${randomBytes(3).toString('hex')}`, scopes: ['org:read'] },
    c.get('ctx'),
    ports,
  );
  return c.json({ created: key.id });
});
const app = new Hono().route('/v1', v1);

const admin = adminClient();
const password = 'correct horse battery';
const suffix = randomBytes(4).toString('hex');
let a: OrgFixture;

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

async function person(name: string, opts: { verified: boolean; role?: 'admin' }) {
  const email = `${name}-${suffix}@example.test`;
  const r = await auth.api.signUpEmail({ body: { email, password, name } });
  await admin`update auth.users set email_verified = ${opts.verified} where id = ${r.user.id}`;
  if (opts.role)
    await executeCommand(addMemberCommand, { userId: r.user.id, role: opts.role }, a.ctx(), ports);
  const login = await call('POST', '/auth/login', undefined, { email, password });
  return { email, userId: r.user.id, token: String(login.body.token) };
}

beforeAll(async () => {
  ({ a } = await twoOrgs());
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('/v1/me scope (M7.2a)', () => {
  it('a signed-in person with a verified email gets a person context: user actor, no org', async () => {
    const p = await person('verified', { verified: true });
    const r = await call('GET', '/me/probe', p.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ userId: p.userId, orgId: null, actor: { type: 'user', userId: p.userId } });
    // The sign-in is a re-authentication, so the context carries it.
    expect(Date.now() - Date.parse(String(r.body.stepUp))).toBeLessThan(STEP_UP_WINDOW_MS);
  });

  it('an unverified email is refused with 403 and a stable reason', async () => {
    const p = await person('unverified', { verified: false });
    const r = await call('GET', '/me/probe', p.token);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'forbidden', details: { reason: 'email_unverified' } });
  });

  it('needs a credential, and an API key is not a person', async () => {
    expect((await call('GET', '/me/probe')).status).toBe(401);
    expect((await call('GET', '/me/probe', a.apiKey)).status).toBe(401);
    expect((await call('GET', '/me/probe', 'not-a-real-session-token-000')).status).toBe(401);
  });

  it('/me and /me/organizations keep answering unverified sessions (they predate the scope)', async () => {
    const p = await person('legacy', { verified: false });
    expect((await call('GET', '/me', p.token)).status).toBe(200);
    expect((await call('GET', '/me/organizations', p.token)).status).toBe(200);
  });

  it('the bearer session carries emailVerified and stepUpAt', async () => {
    const p = await person('fields', { verified: true });
    const s = await sessions.session(p.token);
    expect(s?.user.emailVerified).toBe(true);
    expect(s?.stepUpAt).toBeInstanceOf(Date);
    const u = await person('fields-unverified', { verified: false });
    expect((await sessions.session(u.token))?.user.emailVerified).toBe(false);
  });
});

describe('step-up over /v1 (M7.2a)', () => {
  it('a stepUp command passes within the window and fails once it has passed', async () => {
    const m = await person('admin', { verified: true, role: 'admin' });
    const fresh = await call('POST', `/orgs/${a.org.slug}/probe-step-up`, m.token, {});
    expect(fresh.status).toBe(200);

    // The window passes: the session's step-up is older than STEP_UP_WINDOW_MS.
    const old = new Date(Date.now() - STEP_UP_WINDOW_MS - 60_000);
    await admin`update auth.sessions set step_up_at = ${old}, created_at = ${old} where token = ${m.token}`;
    const stale = await call('POST', `/orgs/${a.org.slug}/probe-step-up`, m.token, {});
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('step_up_required');
  });
});
