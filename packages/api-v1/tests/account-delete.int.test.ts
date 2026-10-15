import { randomBytes } from 'node:crypto';
import {
  appSignIn,
  bearerSessions,
  createAuth,
  fakeIdTokenVerifier,
  findUserById,
  memoryMailer,
  twoFactorService,
} from '@yayatoh/auth';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { executeCommand, STEP_UP_WINDOW_MS } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { addMemberCommand, createOrganization, myOrganizations } from '@yayatoh/tenancy';
import { type OrgFixture, ports, twoOrgs, userCtx } from '@yayatoh/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1 } from '../src/index.ts';
import { memoryRateLimiter } from '../src/rate-limit.ts';

// Account deletion and "sign out everywhere" for the apps (M7.3a), through the real router:
// `DELETE /v1/me` over the web's `deleteAccount`, and `POST /v1/auth/sign-out-everywhere`.
const secret = randomBytes(32).toString('hex');
const { mailer, sent } = memoryMailer();
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer });
const twoFactor = twoFactorService(auth, { mailer });
const verifier = fakeIdTokenVerifier({ secret: 'd'.repeat(64), audiences: { apple: ['a'], google: ['g'] } });
const signIn = appSignIn(auth, { mailer, twoFactor, verifier });
const notices: { to: string; name: string }[] = [];
const v1 = createV1({
  ports,
  sessions: () => bearerSessions(auth),
  appSignIn: () => signIn,
  payments: () => fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' }),
  accountNotice: async (to, user) => {
    notices.push({ to, name: user.name });
  },
  telemetry: false,
  rateLimiter: memoryRateLimiter(),
});
const app = new Hono().route('/v1', v1);
const admin = adminClient();
const suffix = randomBytes(4).toString('hex');
let a: OrgFixture;
let ipCounter = 0;

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  body: Json;
}
async function call(
  method: string,
  path: string,
  o: { token?: string; body?: unknown } = {},
): Promise<Reply> {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-forwarded-for': `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`,
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}
const details = (r: Reply) => (r.body.details ?? {}) as Json;
const addr = (label: string) => `${label}-${suffix}-${randomBytes(2).toString('hex')}@example.test`;
const lastCode = (to: string) =>
  [...sent].reverse().find((m) => m.to === to && m.kind === 'otp')?.value ?? '';

interface Phone {
  email: string;
  userId: string;
  access: string;
  refresh: string;
}
/** One phone signing in with an emailed code (the first sign-in creates the account). */
async function phone(email: string): Promise<Phone> {
  await call('POST', '/auth/email-code', { body: { email } });
  const r = await call('POST', '/auth/token', {
    body: { grantType: 'email_code', email, code: lastCode(email) },
  });
  expect(r.status).toBe(200);
  return {
    email,
    userId: String((r.body.user as Json).id),
    access: String(r.body.accessToken),
    refresh: String(r.body.refreshToken),
  };
}
const backdate = (access: string) => {
  const old = new Date(Date.now() - STEP_UP_WINDOW_MS - 60_000).toISOString();
  return admin`update auth.sessions set step_up_at = ${old}::timestamptz where token = ${access}`;
};
const refreshWith = (refreshToken: string) =>
  call('POST', '/auth/token', { body: { grantType: 'refresh_token', refreshToken } });

beforeAll(async () => {
  ({ a } = await twoOrgs());
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('DELETE /v1/me', () => {
  it('needs a bearer session', async () => {
    expect((await call('DELETE', '/me')).status).toBe(401);
    expect((await call('DELETE', '/me', { token: 'x'.repeat(40) })).status).toBe(401);
  });

  it('refuses without a fresh step-up and deletes nothing', async () => {
    const p = await phone(addr('stale'));
    await backdate(p.access);
    const r = await call('DELETE', '/me', { token: p.access });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('step_up_required');
    expect((await call('GET', '/me', { token: p.access })).status).toBe(200);
    expect((await findUserById(p.userId))?.deletedAt ?? null).toBeNull();
    expect(notices.some((n) => n.to === p.email)).toBe(false);
  });

  it('deletes straight after sign-in (a sign-in is a step-up): tokens end, the old address gets the notice', async () => {
    const p = await phone(addr('fresh'));
    const r = await call('DELETE', '/me', { token: p.access });
    expect(r.status).toBe(200);
    expect(r.body.requestId).toEqual(expect.any(String));
    expect(r.body.summary).toMatchObject({ organizations: expect.any(Number), sessions: expect.any(Number) });
    expect(notices.filter((n) => n.to === p.email)).toHaveLength(1);
    // The account is gone: neither the access token nor the refresh token works any more.
    expect((await call('GET', '/me', { token: p.access })).status).toBe(401);
    const refreshed = await refreshWith(p.refresh);
    expect(refreshed.status).toBe(401);
    expect((await findUserById(p.userId))?.deletedAt).toBeTruthy();
  });

  it('deletes after a step-up with the emailed code when the window had passed', async () => {
    const p = await phone(addr('stepped'));
    await backdate(p.access);
    expect((await call('DELETE', '/me', { token: p.access })).status).toBe(401);
    const start = await call('POST', '/auth/step-up/start', { token: p.access });
    expect(start.body).toEqual({ method: 'email' });
    const up = await call('POST', '/auth/step-up', {
      token: p.access,
      body: { method: 'email', code: lastCode(p.email) },
    });
    expect(up.status).toBe(200);
    expect((await call('DELETE', '/me', { token: p.access })).status).toBe(200);
    expect((await call('GET', '/me', { token: p.access })).status).toBe(401);
  });

  it('deleting twice answers 401 the second time, with the session gone', async () => {
    const p = await phone(addr('twice'));
    expect((await call('DELETE', '/me', { token: p.access })).status).toBe(200);
    expect((await call('DELETE', '/me', { token: p.access })).status).toBe(401);
  });

  it('signing in again with the same address makes a new, empty account', async () => {
    const email = addr('again');
    const first = await phone(email);
    expect((await call('DELETE', '/me', { token: first.access })).status).toBe(200);
    const second = await phone(email);
    expect(second.userId).not.toBe(first.userId);
  });

  it('removes a membership that is not the last owner', async () => {
    const p = await phone(addr('member'));
    await executeCommand(addMemberCommand, { userId: p.userId, role: 'admin' }, a.ctx(), ports);
    expect((await myOrganizations(p.userId)).map((o) => o.orgId)).toContain(a.org.id);
    expect((await call('DELETE', '/me', { token: p.access })).status).toBe(200);
    expect((await myOrganizations(p.userId)).map((o) => o.orgId)).not.toContain(a.org.id);
  });

  it('is refused for the only owner of an organization, naming it, and deletes nothing', async () => {
    const p = await phone(addr('owner'));
    const name = `Solo ${suffix}-${randomBytes(2).toString('hex')}`;
    await createOrganization(
      userCtx(p.userId),
      { slug: `solo-${suffix}-${randomBytes(2).toString('hex')}`, name },
      ports,
    );
    const r = await call('DELETE', '/me', { token: p.access });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('invalid_state');
    expect(details(r).reason).toBe('last_owner');
    expect(details(r).orgs).toEqual([name]);
    expect((await call('GET', '/me', { token: p.access })).status).toBe(200);
    expect(notices.some((n) => n.to === p.email)).toBe(false);
  });
});

describe('while a staff member is acting as the person', () => {
  // The same router, with every session reported as an impersonation (as the web's own-session rule).
  const impersonating = new Hono().route(
    '/v1',
    createV1({
      ports,
      sessions: () => {
        const real = bearerSessions(auth);
        return {
          ...real,
          session: async (token: string) => {
            const s = await real.session(token);
            return s ? { ...s, impersonated: true } : s;
          },
        };
      },
      appSignIn: () => signIn,
      payments: () => fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' }),
      accountNotice: async (to, user) => {
        notices.push({ to, name: user.name });
      },
      telemetry: false,
      rateLimiter: memoryRateLimiter(),
    }),
  );
  const via = async (method: string, path: string, token: string) => {
    const res = await impersonating.request(`/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '10.8.0.1' },
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
  };

  it('refuses to delete the account or sign it out everywhere, and changes nothing', async () => {
    const p = await phone(addr('impersonated'));
    const del = await via('DELETE', '/me', p.access);
    expect(del.status).toBe(403);
    expect((del.body.details as Json).reason).toBe('impersonation');
    const out = await via('POST', '/auth/sign-out-everywhere', p.access);
    expect(out.status).toBe(403);
    expect((await call('GET', '/me', { token: p.access })).status).toBe(200);
    expect((await refreshWith(p.refresh)).status).toBe(200);
    expect(notices.some((n) => n.to === p.email)).toBe(false);
  });
});

describe('POST /v1/auth/sign-out-everywhere', () => {
  it('needs a bearer session', async () => {
    expect((await call('POST', '/auth/sign-out-everywhere')).status).toBe(401);
  });

  it('ends every phone: access tokens stop and no refresh token works again', async () => {
    const email = addr('everywhere');
    const one = await phone(email);
    const two = await phone(email);
    expect(two.userId).toBe(one.userId);
    // A refresh before sign-out proves the second phone's token was live.
    const rotated = await refreshWith(two.refresh);
    expect(rotated.status).toBe(200);
    const twoRefresh = String(rotated.body.refreshToken);

    const out = await call('POST', '/auth/sign-out-everywhere', { token: one.access });
    expect(out.status).toBe(204);

    for (const access of [one.access, String(rotated.body.accessToken)])
      expect((await call('GET', '/me', { token: access })).status).toBe(401);
    for (const refresh of [one.refresh, twoRefresh]) {
      const r = await refreshWith(refresh);
      expect(r.status).toBe(401);
      expect(details(r).reason).toBe('refresh_token_revoked');
    }
    // The account itself is untouched: signing in again works.
    const back = await phone(email);
    expect(back.userId).toBe(one.userId);
    expect((await call('GET', '/me', { token: back.access })).status).toBe(200);
  });

  it('leaves other people alone', async () => {
    const mine = await phone(addr('mine'));
    const theirs = await phone(addr('theirs'));
    expect((await call('POST', '/auth/sign-out-everywhere', { token: mine.access })).status).toBe(204);
    expect((await call('GET', '/me', { token: theirs.access })).status).toBe(200);
    expect((await refreshWith(theirs.refresh)).status).toBe(200);
  });
});
