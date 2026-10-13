import { randomBytes } from 'node:crypto';
import {
  appSignIn,
  bearerSessions,
  createAuth,
  fakeIdTokenVerifier,
  memoryMailer,
  signFakeIdToken,
  twoFactorService,
} from '@yayatoh/auth';
import { identityDatabase } from '@yayatoh/db/identity';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { executeCommand, STEP_UP_WINDOW_MS } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { addMemberCommand, createApiKeyCommand } from '@yayatoh/tenancy';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1 } from '../src/index.ts';
import { memoryRateLimiter } from '../src/rate-limit.ts';

// App sign-in over HTTP (M7.2a): the email code, Apple and Google id_tokens, the two-factor step
// and step-up on bearer sessions, through the real router.
const secret = randomBytes(32).toString('hex');
const { mailer, sent } = memoryMailer();
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer });
const twoFactor = twoFactorService(auth, { mailer });
const FAKE = 'c'.repeat(64);
const APPLE = 'com.yayatoh.app';
const GOOGLE = 'google-ios-client';
const NONCE = 'nonce-0123456789abcdef';
const verifier = fakeIdTokenVerifier({ secret: FAKE, audiences: { apple: [APPLE], google: [GOOGLE] } });
const signIn = appSignIn(auth, { mailer, twoFactor, verifier });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });

function appWith(opts: { withSignIn?: boolean } = {}) {
  const v1 = createV1({
    ports,
    sessions: () => bearerSessions(auth),
    ...(opts.withSignIn === false ? {} : { appSignIn: () => signIn }),
    payments: () => payments,
    telemetry: false,
    rateLimiter: memoryRateLimiter(),
  });
  /** A command marked `stepUp`, run with the request's ctx as a route would. */
  v1.post('/orgs/:org/probe-step-up', async (c) => {
    const key = await executeCommand(
      createApiKeyCommand,
      { name: `probe-${randomBytes(3).toString('hex')}`, scopes: ['org:read'] },
      c.get('ctx'),
      ports,
    );
    return c.json({ created: key.id });
  });
  return new Hono().route('/v1', v1);
}
const app = appWith();

const admin = adminClient();
const suffix = randomBytes(4).toString('hex');
const PASSWORD = 'correct horse battery staple';
let a: OrgFixture;
let ipCounter = 0;

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  body: Json;
  headers: Headers;
}
async function call(
  method: string,
  path: string,
  o: { token?: string; body?: unknown; ip?: string; host?: Hono } = {},
): Promise<Reply> {
  const res = await (o.host ?? app).request(`/v1${path}`, {
    method,
    headers: {
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      // Each call comes from its own address unless a test says otherwise: limits are per client.
      'x-forwarded-for': o.ip ?? `10.7.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`,
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json, headers: res.headers };
}
const token = (body: unknown, ip?: string) => call('POST', '/auth/token', { body, ...(ip ? { ip } : {}) });
const details = (r: Reply) => (r.body.details ?? {}) as Json;

const addr = (label: string) => `${label}-${suffix}-${randomBytes(2).toString('hex')}@example.test`;
const lastCode = (to: string) => [...sent].reverse().find((m) => m.to === to && m.kind === 'otp')?.value ?? '';

async function emailSignIn(email: string) {
  await call('POST', '/auth/email-code', { body: { email } });
  return token({ grantType: 'email_code', email, code: lastCode(email) });
}

async function twoFactorUser(label: string) {
  const email = addr(label);
  const r = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: label } });
  await (await auth.$context).internalAdapter.updateUser(r.user.id, { emailVerified: true });
  const seed = `S${randomBytes(12).toString('hex')}`.slice(0, 20);
  const { totp, secretKey } = await import('@yayatoh/auth/totp');
  await twoFactor.begin(r.user.id, email, { secret: seed });
  const { backupCodes } = await twoFactor.confirm(r.user.id, totp(secretKey(seed), Date.now() - 30_000));
  return {
    id: r.user.id,
    email,
    backupCodes,
    code: () => totp(secretKey(seed), Date.now()),
    nextCode: () => totp(secretKey(seed), Date.now() + 30_000),
  };
}

const idToken = (
  provider: 'apple' | 'google',
  o: { sub: string; email?: string; audience?: string; nonce?: string; ttlSeconds?: number; issuer?: string },
) =>
  signFakeIdToken(FAKE, {
    provider,
    audience: o.audience ?? (provider === 'apple' ? APPLE : GOOGLE),
    nonce: o.nonce ?? NONCE,
    sub: o.sub,
    ...(o.email ? { email: o.email } : {}),
    ...(o.ttlSeconds !== undefined ? { ttlSeconds: o.ttlSeconds } : {}),
    ...(o.issuer ? { issuer: o.issuer } : {}),
  });

beforeAll(async () => {
  ({ a } = await twoOrgs());
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('POST /v1/auth/email-code', () => {
  it('answers 202 with the same body for a known and an unknown address', async () => {
    const known = addr('known');
    await emailSignIn(known);
    const r1 = await call('POST', '/auth/email-code', { body: { email: known } });
    const r2 = await call('POST', '/auth/email-code', { body: { email: addr('unknown') } });
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(r1.body).toEqual(r2.body);
    expect(r1.body).toEqual({ expiresInSeconds: 600 });
    // Address case does not matter.
    expect((await call('POST', '/auth/email-code', { body: { email: known.toUpperCase() } })).status).toBe(202);
  });

  it('rejects malformed requests', async () => {
    for (const body of [{}, { email: 'nope' }, { email: 5 }, { email: `${'a'.repeat(250)}@example.test` }])
      expect((await call('POST', '/auth/email-code', { body })).status).toBe(400);
  });

  it('limits requests per address (the sixth in 15 minutes) with Retry-After', async () => {
    const email = addr('limited');
    for (let i = 0; i < 5; i++)
      expect((await call('POST', '/auth/email-code', { body: { email } })).status).toBe(202);
    const sixth = await call('POST', '/auth/email-code', { body: { email } });
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('rate_limited');
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address from the same client is not affected.
    expect((await call('POST', '/auth/email-code', { body: { email: addr('other') } })).status).toBe(202);
  });

  it('limits requests per client address', async () => {
    const ip = '203.0.113.9';
    let last = 202;
    for (let i = 0; i < 31; i++)
      last = (await call('POST', '/auth/email-code', { body: { email: addr(`ip${i}`) }, ip })).status;
    expect(last).toBe(429);
  });

  it('is not available on a host without app sign-in', async () => {
    const bare = appWith({ withSignIn: false });
    const r = await call('POST', '/auth/email-code', { body: { email: addr('bare') }, host: bare });
    expect(r.status).toBe(404);
  });
});

describe('grantType email_code', () => {
  it('the first sign-in creates a verified account; tokens work on /me; later sign-ins use it', async () => {
    const email = addr('first');
    const first = await emailSignIn(email);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      tokenType: 'bearer',
      user: { email, emailVerified: true },
    });
    const me = await call('GET', '/me', { token: String(first.body.accessToken) });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email, emailVerified: true });
    const second = await emailSignIn(email);
    expect(second.status).toBe(200);
    expect((second.body.user as Json).id).toBe((first.body.user as Json).id);
  });

  it('refuses wrong, malformed and spent codes with the same 401', async () => {
    const email = addr('wrong');
    await call('POST', '/auth/email-code', { body: { email } });
    const good = lastCode(email);
    const wrong = good === '000000' ? '111111' : '000000';
    for (const code of [wrong, 'abc', ' ']) {
      const r = await token({ grantType: 'email_code', email, code });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('unauthenticated');
      expect(details(r).reason).toBe('invalid_code');
    }
    expect((await token({ grantType: 'email_code', email, code: good })).status).toBe(200);
    expect((await token({ grantType: 'email_code', email, code: good })).status).toBe(401);
    // An address that never asked for a code gets the same answer as a wrong one.
    const stranger = await token({ grantType: 'email_code', email: addr('stranger'), code: '123456' });
    expect(stranger.status).toBe(401);
    expect(details(stranger).reason).toBe('invalid_code');
  });

  it('limits attempts per address', async () => {
    const email = addr('brute');
    let last = 0;
    for (let i = 0; i < 6; i++)
      last = (await token({ grantType: 'email_code', email, code: '000000' })).status;
    expect(last).toBe(429);
  });

  it('rejects an unknown grant type and missing fields with 400', async () => {
    expect((await token({ grantType: 'telepathy' })).status).toBe(400);
    expect((await token({ grantType: 'email_code', email: 'a@b.test' })).status).toBe(400);
    expect((await token({ grantType: 'google', idToken: 'x' })).status).toBe(400);
    expect((await token({ grantType: 'google', idToken: 'x', nonce: 'short' })).status).toBe(400);
    expect((await token({ grantType: 'two_factor', challenge: 'x' })).status).toBe(400);
  });
});

describe('two-factor accounts', () => {
  const expectChallenge = (r: Reply) => {
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('step_up_required');
    expect(details(r).reason).toBe('two_factor_required');
    expect(String(details(r).challenge)).toMatch(/^yyc_[A-Za-z0-9_-]{43}$/);
    const lifetime = Date.parse(String(details(r).challengeExpiresAt)) - Date.now();
    expect(lifetime).toBeGreaterThan(4 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(5 * 60_000);
    expect(r.body.accessToken).toBeUndefined();
    return String(details(r).challenge);
  };

  it('every grant returns a challenge instead of tokens, and TOTP completes it', async () => {
    const u = await twoFactorUser('tf-all');
    const viaCode = expectChallenge(await emailSignIn(u.email));
    const viaPassword = expectChallenge(await token({ grantType: 'password', email: u.email, password: PASSWORD }));
    const sub = `g-${suffix}-tfall`;
    const proof = await token({ grantType: 'google', idToken: idToken('google', { sub, email: u.email }), nonce: NONCE });
    expect(details(proof).reason).toBe('email_proof_required');
    const linked = await token({ grantType: 'link_proof', challenge: details(proof).challenge, code: lastCode(u.email) });
    expectChallenge(linked);
    const viaProvider = expectChallenge(
      await token({ grantType: 'google', idToken: idToken('google', { sub, email: u.email }), nonce: NONCE }),
    );

    const done = await token({ grantType: 'two_factor', challenge: viaCode, code: u.code() });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ tokenType: 'bearer', user: { id: u.id } });
    expect((await call('GET', '/me', { token: String(done.body.accessToken) })).status).toBe(200);

    // The other challenges are each good once, for a code that has not been spent.
    const second = await token({ grantType: 'two_factor', challenge: viaPassword, code: u.nextCode() });
    expect(second.status).toBe(200);
    const third = await token({ grantType: 'two_factor', challenge: viaProvider, code: u.backupCodes[0] });
    expect(third.status).toBe(200);
  });

  it('a challenge works once and then is refused, whatever the code', async () => {
    const u = await twoFactorUser('tf-once');
    const ch = expectChallenge(await emailSignIn(u.email));
    expect((await token({ grantType: 'two_factor', challenge: ch, code: u.code() })).status).toBe(200);
    const again = await token({ grantType: 'two_factor', challenge: ch, code: u.nextCode() });
    expect(again.status).toBe(401);
    expect(details(again).reason).toBe('invalid_challenge');
  });

  it('a challenge expires after five minutes', async () => {
    const u = await twoFactorUser('tf-expire');
    const ch = expectChallenge(await emailSignIn(u.email));
    await identityDatabase().execute(
      sql`update auth.verifications set expires_at = now() - interval '1 second' where identifier like 'yy-app-challenge:%' and value like ${`%${u.id}%`}`,
    );
    const r = await token({ grantType: 'two_factor', challenge: ch, code: u.code() });
    expect(r.status).toBe(401);
    expect(details(r).reason).toBe('invalid_challenge');
  });

  it('wrong codes never give tokens; five spend the challenge', async () => {
    const u = await twoFactorUser('tf-wrong');
    const ch = expectChallenge(await emailSignIn(u.email));
    for (let i = 0; i < 4; i++) {
      const r = await token({ grantType: 'two_factor', challenge: ch, code: '000000' });
      expect(r.status).toBe(401);
      expect(details(r).reason).toBe('invalid_code');
    }
    const fifth = await token({ grantType: 'two_factor', challenge: ch, code: '000000' });
    expect(details(fifth).reason).toBe('too_many_attempts');
    expect((await token({ grantType: 'two_factor', challenge: ch, code: u.code() })).status).toBe(401);
  });

  it('refuses a made-up, malformed or foreign challenge', async () => {
    const u = await twoFactorUser('tf-made-up');
    for (const challenge of ['nope', `yyc_${'A'.repeat(43)}`, `yyr_${'A'.repeat(43)}`]) {
      const r = await token({ grantType: 'two_factor', challenge, code: u.code() });
      expect(r.status).toBe(401);
      expect(details(r).reason).toBe('invalid_challenge');
    }
    expect((await token({ grantType: 'two_factor', challenge: '', code: u.code() })).status).toBe(400);
  });

  it('a password sign-in still answers with the old code and reason, now with a challenge', async () => {
    const u = await twoFactorUser('tf-pw');
    const r = await token({ grantType: 'password', email: u.email, password: PASSWORD });
    expect(r.body.code).toBe('step_up_required');
    expect(details(r).reason).toBe('two_factor_required');
    // A wrong password is still just a wrong password.
    expect((await token({ grantType: 'password', email: u.email, password: 'wrong-password' })).status).toBe(401);
  });
});

describe('grantType apple and google', () => {
  it('a new Google identity creates a verified account and signs in again by identity', async () => {
    const email = addr('goog');
    const sub = `g-${suffix}-a`;
    const first = await token({ grantType: 'google', idToken: idToken('google', { sub, email }), nonce: NONCE });
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ email, emailVerified: true });
    const again = await token({ grantType: 'google', idToken: idToken('google', { sub, email }), nonce: NONCE });
    expect((again.body.user as Json).id).toBe((first.body.user as Json).id);
  });

  it('a valid Apple token with an unknown private-relay address creates a new account', async () => {
    const email = `${randomBytes(6).toString('hex')}@privaterelay.appleid.com`;
    const r = await token({
      grantType: 'apple',
      idToken: idToken('apple', { sub: `a-${suffix}-relay`, email }),
      nonce: NONCE,
      name: 'Ann Apple',
    });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ email, name: 'Ann Apple', emailVerified: true });
  });

  it('refuses wrong audience, issuer, signature, expiry and nonce with the same 401', async () => {
    const email = addr('refused');
    const sub = `g-${suffix}-bad`;
    const bad: [string, string][] = [
      ['audience', idToken('google', { sub, email, audience: 'someone-elses-app' })],
      ['issuer', idToken('google', { sub, email, issuer: 'https://evil.example' })],
      ['expiry', idToken('google', { sub, email, ttlSeconds: -300 })],
      ['signature', signFakeIdToken('d'.repeat(64), { provider: 'google', audience: GOOGLE, nonce: NONCE, sub, email })],
      ['garbage', 'not.a.token'],
    ];
    for (const [, idTokenValue] of bad) {
      const r = await token({ grantType: 'google', idToken: idTokenValue, nonce: NONCE });
      expect(r.status).toBe(401);
      expect(details(r).reason).toBe('invalid_id_token');
    }
    const nonce = await token({
      grantType: 'google',
      idToken: idToken('google', { sub, email }),
      nonce: 'a-different-nonce-value',
    });
    expect(nonce.status).toBe(401);
    expect(details(nonce).reason).toBe('invalid_id_token');
    // An Apple token is not accepted as Google, and the other way round.
    const swapped = await token({
      grantType: 'google',
      idToken: idToken('apple', { sub, email }),
      nonce: NONCE,
    });
    expect(details(swapped).reason).toBe('invalid_id_token');
    // None of it created the account.
    const [row] = await admin`select count(*)::int as n from auth.users where email = ${email}`;
    expect(row?.n).toBe(0);
  });

  it('an existing account is linked only after the emailed code proves the address', async () => {
    const email = addr('link');
    const made = await emailSignIn(email);
    const sub = `g-${suffix}-link`;
    const step = await token({ grantType: 'google', idToken: idToken('google', { sub, email }), nonce: NONCE });
    expect(step.status).toBe(401);
    expect(step.body.code).toBe('step_up_required');
    expect(details(step).reason).toBe('email_proof_required');
    const challenge = String(details(step).challenge);
    expect(step.body.accessToken).toBeUndefined();

    const wrong = lastCode(email) === '000000' ? '111111' : '000000';
    const bad = await token({ grantType: 'link_proof', challenge, code: wrong });
    expect(details(bad).reason).toBe('invalid_code');
    const ok = await token({ grantType: 'link_proof', challenge, code: lastCode(email) });
    expect(ok.status).toBe(200);
    expect((ok.body.user as Json).id).toBe((made.body.user as Json).id);
    // The identity now signs in directly; the proof cannot be replayed.
    const direct = await token({ grantType: 'google', idToken: idToken('google', { sub, email }), nonce: NONCE });
    expect(direct.status).toBe(200);
    const replay = await token({ grantType: 'link_proof', challenge, code: lastCode(email) });
    expect(replay.status).toBe(401);
  });
});

describe('step-up on a bearer session', () => {
  async function adminSession(label: string) {
    const email = addr(label);
    const signed = await emailSignIn(email);
    const userId = String((signed.body.user as Json).id);
    await executeCommand(addMemberCommand, { userId, role: 'admin' }, a.ctx(), ports);
    return { email, userId, access: String(signed.body.accessToken) };
  }
  const probe = (access: string) =>
    call('POST', `/orgs/${a.org.slug}/probe-step-up`, { token: access, body: {} });
  const backdate = (access: string) => {
    const old = new Date(Date.now() - STEP_UP_WINDOW_MS - 60_000).toISOString();
    return admin`update auth.sessions set step_up_at = ${old}::timestamptz where token = ${access}`;
  };

  it('a stepUp command passes straight after sign-in, fails once the window has passed, and passes after step-up', async () => {
    const s = await adminSession('stepup-email');
    expect((await probe(s.access)).status).toBe(200);

    await backdate(s.access);
    const stale = await probe(s.access);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('step_up_required');

    // No authenticator, no password: an emailed code.
    const start = await call('POST', '/auth/step-up/start', { token: s.access });
    expect(start.status).toBe(200);
    expect(start.body).toEqual({ method: 'email' });
    const code = lastCode(s.email);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await call('POST', '/auth/step-up', {
      token: s.access,
      body: { method: 'email', code: code === '000000' ? '111111' : '000000' },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('validation_failed');
    expect(details(wrong).reason).toBe('invalid_code');
    expect((await probe(s.access)).status).toBe(401);

    const ok = await call('POST', '/auth/step-up', { token: s.access, body: { method: 'email', code } });
    expect(ok.status).toBe(200);
    const at = Date.parse(String(ok.body.stepUpAt));
    expect(Date.now() - at).toBeLessThan(10_000);
    expect(Date.parse(String(ok.body.expiresAt)) - at).toBe(STEP_UP_WINDOW_MS);
    expect((await probe(s.access)).status).toBe(200);

    // The code was single use.
    expect((await call('POST', '/auth/step-up', { token: s.access, body: { method: 'email', code } })).status).toBe(400);
  });

  it('a person with an authenticator steps up with it; the other methods are refused', async () => {
    const u = await twoFactorUser('stepup-totp');
    await executeCommand(addMemberCommand, { userId: u.id, role: 'admin' }, a.ctx(), ports);
    const ch = String(details(await emailSignIn(u.email)).challenge);
    const done = await token({ grantType: 'two_factor', challenge: ch, code: u.code() });
    const access = String(done.body.accessToken);
    await backdate(access);
    expect((await probe(access)).status).toBe(401);

    expect((await call('POST', '/auth/step-up/start', { token: access })).body).toEqual({ method: 'totp' });
    for (const body of [
      { method: 'email', code: '123456' },
      { method: 'password', password: PASSWORD },
    ]) {
      const refused = await call('POST', '/auth/step-up', { token: access, body });
      expect(refused.status).toBe(400);
    }
    expect((await probe(access)).status).toBe(401);
    const ok = await call('POST', '/auth/step-up', { token: access, body: { method: 'totp', code: u.nextCode() } });
    expect(ok.status).toBe(200);
    expect((await probe(access)).status).toBe(200);
  });

  it('five wrong proofs pause the person (429)', async () => {
    const s = await adminSession('stepup-limit');
    let last = 0;
    for (let i = 0; i < 6; i++)
      last = (await call('POST', '/auth/step-up', { token: s.access, body: { method: 'email', code: '000000' } })).status;
    expect(last).toBe(429);
  });

  it('needs a user session: an API key or no credential is refused, bodies are validated', async () => {
    expect((await call('POST', '/auth/step-up/start')).status).toBe(401);
    expect((await call('POST', '/auth/step-up', { body: { method: 'email', code: '123456' } })).status).toBe(401);
    expect((await call('POST', '/auth/step-up/start', { token: a.apiKey })).status).toBe(401);
    const s = await adminSession('stepup-validate');
    for (const body of [{}, { method: 'telepathy' }, { method: 'totp' }, { method: 'password' }])
      expect((await call('POST', '/auth/step-up', { token: s.access, body })).status).toBe(400);
  });

  it('limits the emails a step-up can send', async () => {
    const s = await adminSession('stepup-mail');
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await call('POST', '/auth/step-up/start', { token: s.access })).status;
    expect(last).toBe(429);
  });
});

describe('refresh and revoke are unchanged for the new grants', () => {
  it('tokens from an email code rotate on refresh, and a reused refresh token revokes the family', async () => {
    const signed = await emailSignIn(addr('rotate'));
    const refreshToken = String(signed.body.refreshToken);
    const rotated = await token({ grantType: 'refresh_token', refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(refreshToken);
    const reuse = await token({ grantType: 'refresh_token', refreshToken });
    expect(reuse.status).toBe(401);
    expect(details(reuse).reason).toBe('refresh_token_reused');
    expect((await call('GET', '/me', { token: String(rotated.body.accessToken) })).status).toBe(401);
  });
});
