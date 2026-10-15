import { randomBytes } from 'node:crypto';
import {
  appSignIn,
  bearerSessions,
  createAuth,
  fakeIdTokenVerifier,
  memoryMailer,
  twoFactorService,
} from '@yayatoh/auth';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { fakePaymentProvider } from '@yayatoh/payments';
import { createRateLimiter, memoryRateLimitStore } from '@yayatoh/platform/security';
import { ports } from '@yayatoh/testing';
import { Hono } from 'hono';
import { afterAll, describe, expect, it } from 'vitest';
import { createV1 } from '../src/index.ts';
import { memoryRateLimiter } from '../src/rate-limit.ts';

// M7.x hardening, through the real router: the sign-in counters are shared by every server
// instance, and answers that carry a person's data or a credential are never stored by a cache.
const secret = randomBytes(32).toString('hex');
const { mailer, sent } = memoryMailer();
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer });
const twoFactor = twoFactorService(auth, { mailer });
const verifier = fakeIdTokenVerifier({
  secret: 'd'.repeat(64),
  audiences: { apple: ['com.yayatoh.app'], google: ['google-ios-client'] },
});
const signIn = appSignIn(auth, { mailer, twoFactor, verifier });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const admin = adminClient();
const suffix = randomBytes(4).toString('hex');

afterAll(async () => {
  await admin.end();
  await closePools();
});

/** One server instance: its own in-memory limiter, the shared store behind `authLimiter`. */
function instance(shared: ReturnType<typeof createRateLimiter>) {
  const v1 = createV1({
    ports,
    sessions: () => bearerSessions(auth),
    appSignIn: () => signIn,
    payments: () => payments,
    telemetry: false,
    rateLimiter: memoryRateLimiter(),
    authLimiter: shared,
  });
  return new Hono().route('/v1', v1);
}

let ipCounter = 0;
async function call(host: Hono, method: string, path: string, o: { token?: string; body?: unknown } = {}) {
  const res = await host.request(`/v1${path}`, {
    method,
    headers: {
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      // Every call comes from its own address, so only the per-address counters can stop it.
      'x-forwarded-for': `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`,
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> | null,
  };
}

const addr = (label: string) => `${label}-${suffix}-${randomBytes(2).toString('hex')}@example.test`;

describe('sign-in counters are shared across server instances', () => {
  it('a code is not emailed a sixth time to one address, whichever instance is asked', async () => {
    const shared = createRateLimiter(memoryRateLimitStore());
    const hosts = [instance(shared), instance(shared), instance(shared)];
    const email = addr('bomb');
    // Five requests, spread over the instances: each instance saw at most two of them.
    for (let i = 0; i < 5; i++) {
      const r = await call(hosts[i % 3] as Hono, 'POST', '/auth/email-code', { body: { email } });
      expect(r.status).toBe(202);
    }
    const sixth = await call(hosts[2] as Hono, 'POST', '/auth/email-code', { body: { email } });
    expect(sixth.status).toBe(429);
    expect(sixth.body?.code).toBe('rate_limited');
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    // The address under attack is the one that is limited, not the whole network.
    const other = await call(hosts[0] as Hono, 'POST', '/auth/email-code', {
      body: { email: addr('other') },
    });
    expect(other.status).toBe(202);
    // Case does not give the attacker a second bucket.
    const upper = await call(hosts[1] as Hono, 'POST', '/auth/email-code', {
      body: { email: email.toUpperCase() },
    });
    expect(upper.status).toBe(429);
    expect(sent.filter((m) => m.to === email && m.kind === 'otp')).toHaveLength(5);
  });

  it('code guesses for one address stop after ten, spread over instances', async () => {
    const shared = createRateLimiter(memoryRateLimitStore());
    const hosts = Array.from({ length: 5 }, () => instance(shared));
    const email = addr('guess');
    const statuses: number[] = [];
    // Two guesses per instance: none of them reaches the in-memory limit of five.
    for (let i = 0; i < 11; i++) {
      const r = await call(hosts[i % 5] as Hono, 'POST', '/auth/token', {
        body: { grantType: 'email_code', email, code: '000000' },
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('answers for one challenge stop after ten tries, spread over instances', async () => {
    const shared = createRateLimiter(memoryRateLimitStore());
    const hosts = Array.from({ length: 5 }, () => instance(shared));
    const challenge = `yyc_${randomBytes(32).toString('base64url')}`;
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await call(hosts[i % 5] as Hono, 'POST', '/auth/token', {
        body: { grantType: 'two_factor', challenge, code: '123456' },
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('the emailed step-up code is limited per person across instances', async () => {
    const shared = createRateLimiter(memoryRateLimitStore());
    const hosts = Array.from({ length: 4 }, () => instance(shared));
    const email = addr('stepup');
    const made = await auth.api.signUpEmail({
      body: { email, password: 'correct horse battery', name: 'S' },
    });
    await (await auth.$context).internalAdapter.updateUser(made.user.id, { emailVerified: true });
    const signedIn = await call(hosts[0] as Hono, 'POST', '/auth/login', {
      body: { email, password: 'correct horse battery' },
    });
    expect(signedIn.status).toBe(200);
    const bearer = String(signedIn.body?.token);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push(
        (await call(hosts[i % 4] as Hono, 'POST', '/auth/step-up/start', { token: bearer })).status,
      );
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe('answers with a person’s data or a credential are not cached', () => {
  const host = instance(createRateLimiter(memoryRateLimitStore()));

  it('tokens, the signed-in person and /me answers are private, no-store', async () => {
    const email = addr('cache');
    await call(host, 'POST', '/auth/email-code', { body: { email } });
    const code = [...sent].reverse().find((m) => m.to === email && m.kind === 'otp')?.value ?? '';
    const tokens = await call(host, 'POST', '/auth/token', {
      body: { grantType: 'email_code', email, code },
    });
    expect(tokens.status).toBe(200);
    expect(tokens.headers.get('cache-control')).toBe('private, no-store');
    const bearer = String(tokens.body?.accessToken);
    for (const path of ['/me', '/me/organizations', '/me/tickets', '/me/orders']) {
      const r = await call(host, 'GET', path, { token: bearer });
      expect(r.status, path).toBe(200);
      expect(r.headers.get('cache-control'), path).toBe('private, no-store');
    }
    // The request for a code and a refusal are not cacheable either.
    const asked = await call(host, 'POST', '/auth/email-code', { body: { email } });
    expect(asked.headers.get('cache-control')).toBe('private, no-store');
    const refused = await call(host, 'GET', '/me/tickets');
    expect(refused.status).toBe(401);
    expect(refused.headers.get('cache-control')).toBe('no-store');
  });

  it('the public reads keep their own cache rules', async () => {
    const config = await call(host, 'GET', '/mobile/config');
    expect(config.status).toBe(200);
    expect(config.headers.get('cache-control')).toBeNull();
  });
});
