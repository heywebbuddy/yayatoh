import { randomBytes } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { closePools } from '@yayatoh/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appSignIn,
  bearerSessions,
  CHALLENGE_ATTEMPTS,
  CHALLENGE_TTL_MS,
  createAuth,
  fakeIdTokenVerifier,
  memoryMailer,
  signFakeIdToken,
  twoFactorService,
} from '../src/index.ts';
import { secretKey, totp } from '../src/totp.ts';

const { mailer, sent } = memoryMailer();
const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:3998', secret, mailer });
const twoFactor = twoFactorService(auth, { mailer });
const FAKE = 'a'.repeat(64);
const APPLE = 'com.yayatoh.app';
const GOOGLE = 'google-ios-client';
const verifier = fakeIdTokenVerifier({ secret: FAKE, audiences: { apple: [APPLE], google: [GOOGLE] } });
const app = appSignIn(auth, { mailer, twoFactor, verifier });
const sessions = bearerSessions(auth);
const suffix = randomBytes(4).toString('hex');
const PASSWORD = 'correct horse battery staple';

afterAll(closePools);

const addr = (label: string) => `${label}-${suffix}-${randomBytes(2).toString('hex')}@example.test`;
const lastCode = (to: string) =>
  [...sent].reverse().find((m) => m.to === to && m.kind === 'otp')?.value ?? '';

async function userRow(email: string) {
  const [row] = await identityDatabase().execute<{ id: string; email_verified: boolean; name: string }>(
    sql`select id, email_verified, name from auth.users where email = ${email}`,
  );
  return row;
}
const count = async (q: ReturnType<typeof sql>) =>
  Number((await identityDatabase().execute<{ n: string }>(q))[0]?.n);

/** An account with a password and TOTP, like a web user who turned two-step verification on. */
async function twoFactorUser(label: string) {
  const email = addr(label);
  const r = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: label } });
  await (await auth.$context).internalAdapter.updateUser(r.user.id, { emailVerified: true });
  const seed = `S${randomBytes(12).toString('hex')}`.slice(0, 20);
  // The sign-up made a session; start from none so tests can see what a sign-in leaves behind.
  await identityDatabase().execute(sql`delete from auth.sessions where user_id = ${r.user.id}`);
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

async function emailCodeTokens(email: string) {
  await app.requestEmailCode(email);
  return app.signInWithEmailCode(email, lastCode(email));
}

describe('email code', () => {
  it('the first sign-in creates an account with the address verified; later ones use it', async () => {
    const email = addr('newcomer');
    expect(await userRow(email)).toBeUndefined();
    expect(await app.requestEmailCode(email)).toEqual({ expiresInSeconds: 600 });
    const first = await app.signInWithEmailCode(email, lastCode(email));
    expect(first.ok).toBe(true);
    const made = await userRow(email);
    expect(made?.email_verified).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.tokens.user).toMatchObject({ id: made?.id, email });
    expect(first.tokens.refreshToken).toMatch(/^yyr_/);
    // The access token is a live bearer session that carries the verified email and the sign-in.
    const s = await sessions.session(first.tokens.accessToken);
    expect(s?.user.emailVerified).toBe(true);
    expect(s?.stepUpAt).toBeInstanceOf(Date);

    const second = await emailCodeTokens(email);
    expect(second.ok && second.tokens.user.id).toBe(made?.id);
    expect(await count(sql`select count(*) as n from auth.users where email = ${email}`)).toBe(1);
  });

  it('a person who signed up with a password and never verified is promoted by the code, not duplicated', async () => {
    const email = addr('unverified');
    const r = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Una' } });
    expect((await userRow(email))?.email_verified).toBe(false);
    const res = await emailCodeTokens(email);
    expect(res.ok).toBe(true);
    expect((await userRow(email))?.email_verified).toBe(true);
    expect((await userRow(email))?.id).toBe(r.user.id);
    // Pre-hijack guard: whoever typed the address at sign-up loses the password they set.
    await expect(auth.api.signInEmail({ body: { email, password: PASSWORD } })).rejects.toBeDefined();
    // A wrong code on such an account is refused without touching it.
    const other = addr('unverified-wrong');
    await auth.api.signUpEmail({ body: { email: other, password: PASSWORD, name: 'Una' } });
    await app.requestEmailCode(other);
    const code = lastCode(other);
    expect(await app.signInWithEmailCode(other, code === '000000' ? '111111' : '000000')).toEqual({
      ok: false,
      reason: 'invalid_code',
    });
    expect((await userRow(other))?.email_verified).toBe(false);
    await expect(auth.api.signInEmail({ body: { email: other, password: PASSWORD } })).resolves.toBeDefined();
  });

  it('requests for known and unknown addresses look the same and both send a code', async () => {
    const known = addr('known');
    await emailCodeTokens(known);
    const unknown = addr('unknown');
    const before = sent.length;
    const a = await app.requestEmailCode(known);
    const b = await app.requestEmailCode(unknown);
    expect(a).toEqual(b);
    expect(sent.length - before).toBe(2);
    expect(lastCode(known)).toMatch(/^\d{6}$/);
    expect(lastCode(unknown)).toMatch(/^\d{6}$/);
    // Asking did not create the unknown address.
    expect(await userRow(unknown)).toBeUndefined();
  });

  it('refuses a wrong, malformed or reused code, and a code is good for three tries', async () => {
    const email = addr('wrong');
    await app.requestEmailCode(email);
    const code = lastCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await app.signInWithEmailCode(email, wrong)).toEqual({ ok: false, reason: 'invalid_code' });
    expect(await app.signInWithEmailCode(email, 'abc')).toEqual({ ok: false, reason: 'invalid_code' });
    expect(await app.signInWithEmailCode(email, '')).toEqual({ ok: false, reason: 'invalid_code' });
    expect((await app.signInWithEmailCode(email, code)).ok).toBe(true);
    // Spent.
    expect(await app.signInWithEmailCode(email, code)).toEqual({ ok: false, reason: 'invalid_code' });

    const other = addr('tries');
    await app.requestEmailCode(other);
    const right = lastCode(other);
    const miss = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) await app.signInWithEmailCode(other, miss);
    // Three misses burn the code: the right one no longer works.
    const r = await app.signInWithEmailCode(other, right);
    expect(r.ok).toBe(false);
  });

  it('refuses a code that has expired', async () => {
    const email = addr('expired');
    await app.requestEmailCode(email);
    const code = lastCode(email);
    await identityDatabase().execute(
      sql`update auth.verifications set expires_at = now() - interval '1 minute' where identifier = ${`sign-in-otp-${email}`}`,
    );
    expect(await app.signInWithEmailCode(email, code)).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('a code for one address does not sign in another', async () => {
    const a = addr('alice');
    const b = addr('bob');
    await app.requestEmailCode(a);
    await app.requestEmailCode(b);
    expect((await app.signInWithEmailCode(b, lastCode(a))).ok === true && lastCode(a) !== lastCode(b)).toBe(
      false,
    );
  });
});

describe('two-factor step', () => {
  it('an email code on a two-factor account gets a challenge, never tokens', async () => {
    const u = await twoFactorUser('tf-email');
    const r = await emailCodeTokens(u.email);
    expect(r).toMatchObject({ ok: false, reason: 'two_factor_required' });
    if (r.ok || r.reason !== 'two_factor_required') throw new Error('unreachable');
    expect(r.challenge.token).toMatch(/^yyc_[A-Za-z0-9_-]{43}$/);
    expect(r.challenge.expiresAt.getTime() - Date.now()).toBeGreaterThan(CHALLENGE_TTL_MS - 5_000);
    expect(r.challenge.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(CHALLENGE_TTL_MS);
    // No session was left behind by the first factor.
    expect(await count(sql`select count(*) as n from auth.sessions where user_id = ${u.id}`)).toBe(0);

    const done = await app.completeTwoFactor(r.challenge.token, u.code());
    expect(done.ok).toBe(true);
    expect(done.ok && done.tokens.user.id).toBe(u.id);
    expect(await sessions.session((done.ok && done.tokens.accessToken) || 'x'.repeat(20))).not.toBeNull();
  });

  it('a challenge works once', async () => {
    const u = await twoFactorUser('tf-once');
    const r = await emailCodeTokens(u.email);
    if (r.ok || r.reason !== 'two_factor_required') throw new Error('expected a challenge');
    const first = await app.completeTwoFactor(r.challenge.token, u.code());
    expect(first.ok).toBe(true);
    // Replaying the same challenge, with another valid code, is refused.
    expect(await app.completeTwoFactor(r.challenge.token, u.nextCode())).toEqual({
      ok: false,
      reason: 'invalid_challenge',
    });
  });

  it('a challenge expires after five minutes', async () => {
    const u = await twoFactorUser('tf-expiry');
    const r = await emailCodeTokens(u.email);
    if (r.ok || r.reason !== 'two_factor_required') throw new Error('expected a challenge');
    await identityDatabase().execute(
      sql`update auth.verifications set expires_at = now() - interval '1 second' where identifier like 'yy-app-challenge:%' and value like ${`%${u.id}%`}`,
    );
    expect(await app.completeTwoFactor(r.challenge.token, u.code())).toEqual({
      ok: false,
      reason: 'invalid_challenge',
    });
  });

  it('wrong codes are refused and counted; the challenge dies after five', async () => {
    const u = await twoFactorUser('tf-wrong');
    const r = await emailCodeTokens(u.email);
    if (r.ok || r.reason !== 'two_factor_required') throw new Error('expected a challenge');
    for (let i = 1; i < CHALLENGE_ATTEMPTS; i++)
      expect(await app.completeTwoFactor(r.challenge.token, '000000')).toEqual({
        ok: false,
        reason: 'invalid_code',
      });
    expect(await app.completeTwoFactor(r.challenge.token, '000000')).toEqual({
      ok: false,
      reason: 'too_many_attempts',
    });
    // Even the right code cannot revive it.
    expect((await app.completeTwoFactor(r.challenge.token, u.code())).ok).toBe(false);
  });

  it('a backup code finishes the step once', async () => {
    const u = await twoFactorUser('tf-backup');
    const first = await emailCodeTokens(u.email);
    if (first.ok || first.reason !== 'two_factor_required') throw new Error('expected a challenge');
    const backup = u.backupCodes[0] ?? '';
    expect((await app.completeTwoFactor(first.challenge.token, backup)).ok).toBe(true);
    const again = await emailCodeTokens(u.email);
    if (again.ok || again.reason !== 'two_factor_required') throw new Error('expected a challenge');
    expect((await app.completeTwoFactor(again.challenge.token, backup)).ok).toBe(false);
  });

  it('an authenticator code works once (replay protection), and garbage challenges are refused', async () => {
    const u = await twoFactorUser('tf-replay');
    const one = await emailCodeTokens(u.email);
    if (one.ok || one.reason !== 'two_factor_required') throw new Error('expected a challenge');
    const code = u.code();
    expect((await app.completeTwoFactor(one.challenge.token, code)).ok).toBe(true);
    const two = await emailCodeTokens(u.email);
    if (two.ok || two.reason !== 'two_factor_required') throw new Error('expected a challenge');
    expect((await app.completeTwoFactor(two.challenge.token, code)).ok).toBe(false);

    for (const bad of ['', 'nope', `yyc_${'A'.repeat(43)}`, 'yyr_'.padEnd(47, 'A')])
      expect(await app.completeTwoFactor(bad, code)).toEqual({ ok: false, reason: 'invalid_challenge' });
  });

  it('a password first factor can open the same challenge', async () => {
    const u = await twoFactorUser('tf-password');
    const c = await app.challengeForPassword(u.email);
    expect(c?.token).toMatch(/^yyc_/);
    expect((await app.completeTwoFactor(c?.token ?? '', u.code())).ok).toBe(true);
    expect(await app.challengeForPassword(addr('nobody'))).toBeNull();
  });

  it('a person without two-factor gets tokens straight away', async () => {
    const r = await emailCodeTokens(addr('plain'));
    expect(r.ok).toBe(true);
  });
});

describe('Apple and Google', () => {
  const NONCE = 'nonce-0123456789abcdef';
  const idToken = (
    provider: 'apple' | 'google',
    o: { sub: string; email?: string; emailVerified?: boolean; name?: string; audience?: string },
  ) =>
    signFakeIdToken(FAKE, {
      provider,
      audience: o.audience ?? (provider === 'apple' ? APPLE : GOOGLE),
      nonce: NONCE,
      sub: o.sub,
      ...(o.email ? { email: o.email } : {}),
      ...(o.emailVerified !== undefined ? { emailVerified: o.emailVerified } : {}),
      ...(o.name ? { name: o.name } : {}),
    });
  const signIn = (provider: 'apple' | 'google', token: string, nonce = NONCE, name?: string) =>
    app.signInWithIdToken({ provider, idToken: token, nonce, ...(name ? { name } : {}) });

  it('a new Google identity creates a verified account; the same identity signs in again', async () => {
    const email = addr('goog');
    const sub = `g-${suffix}-1`;
    const first = await signIn('google', idToken('google', { sub, email, name: 'Goo Gle' }));
    expect(first.ok).toBe(true);
    const made = await userRow(email);
    expect(made).toMatchObject({ email_verified: true, name: 'Goo Gle' });
    const again = await signIn('google', idToken('google', { sub, email, name: 'Goo Gle' }));
    expect(again.ok && again.tokens.user.id).toBe(made?.id);
    // The identity, not the address, is what links: a changed address still signs in.
    const moved = await signIn('google', idToken('google', { sub, email: addr('goog-new') }));
    expect(moved.ok && moved.tokens.user.id).toBe(made?.id);
  });

  it('a valid Apple token with an unknown private-relay address creates a new account', async () => {
    const email = `${randomBytes(6).toString('hex')}@privaterelay.appleid.com`;
    const r = await signIn(
      'apple',
      idToken('apple', { sub: `a-${suffix}-relay`, email }),
      NONCE,
      'Ann Apple',
    );
    expect(r.ok).toBe(true);
    expect(await userRow(email)).toMatchObject({ email_verified: true, name: 'Ann Apple' });
  });

  it('an id_token with a wrong audience, nonce, signature or expiry is refused and creates nothing', async () => {
    const email = addr('refused');
    const sub = `g-${suffix}-refused`;
    const cases: string[] = [
      idToken('google', { sub, email, audience: 'someone-elses-app' }),
      signFakeIdToken(FAKE, {
        provider: 'google',
        audience: GOOGLE,
        nonce: NONCE,
        sub,
        email,
        ttlSeconds: -120,
      }),
      signFakeIdToken(FAKE, {
        provider: 'google',
        audience: GOOGLE,
        nonce: NONCE,
        sub,
        email,
        issuer: 'https://evil.example',
      }),
      signFakeIdToken('b'.repeat(64), { provider: 'google', audience: GOOGLE, nonce: NONCE, sub, email }),
      'garbage',
    ];
    for (const t of cases)
      expect(await signIn('google', t)).toEqual({ ok: false, reason: 'invalid_id_token' });
    expect(await signIn('google', idToken('google', { sub, email }), 'a-different-nonce')).toEqual({
      ok: false,
      reason: 'invalid_id_token',
    });
    expect(await userRow(email)).toBeUndefined();
  });

  it('refuses a provider identity with no email or an unverified one, for a new account', async () => {
    expect(await signIn('google', idToken('google', { sub: `g-${suffix}-noemail` }))).toEqual({
      ok: false,
      reason: 'provider_email_missing',
    });
    expect(
      await signIn(
        'google',
        idToken('google', { sub: `g-${suffix}-unv`, email: addr('unv'), emailVerified: false }),
      ),
    ).toEqual({ ok: false, reason: 'provider_email_unverified' });
  });

  it('the same email on an existing account needs the emailed code before the provider links', async () => {
    const existing = addr('existing');
    const made = await emailCodeTokens(existing);
    if (!made.ok) throw new Error('setup');
    const sub = `g-${suffix}-link`;
    const r = await signIn('google', idToken('google', { sub, email: existing }));
    expect(r).toMatchObject({ ok: false, reason: 'link_proof_required' });
    if (r.ok || r.reason !== 'link_proof_required') throw new Error('unreachable');
    // No tokens, no link yet, and a code went to the account's address.
    expect(await count(sql`select count(*) as n from auth.accounts where account_id = ${sub}`)).toBe(0);
    const code = lastCode(existing);
    expect(code).toMatch(/^\d{6}$/);

    expect(await app.completeLinkProof(r.challenge.token, code === '000000' ? '111111' : '000000')).toEqual({
      ok: false,
      reason: 'invalid_code',
    });
    const done = await app.completeLinkProof(r.challenge.token, code);
    expect(done.ok && done.tokens.user.id).toBe(made.tokens.user.id);
    // Now the identity is linked: it signs in directly.
    const next = await signIn('google', idToken('google', { sub, email: existing }));
    expect(next.ok && next.tokens.user.id).toBe(made.tokens.user.id);
    // The proof is single use.
    expect(await app.completeLinkProof(r.challenge.token, code)).toEqual({
      ok: false,
      reason: 'invalid_challenge',
    });
  });

  it('a provider sign-in on a two-factor account still takes the second step', async () => {
    const u = await twoFactorUser('tf-social');
    const sub = `g-${suffix}-tf`;
    const r = await signIn('google', idToken('google', { sub, email: u.email }));
    if (r.ok || r.reason !== 'link_proof_required') throw new Error('expected a link proof');
    const linked = await app.completeLinkProof(r.challenge.token, lastCode(u.email));
    expect(linked).toMatchObject({ ok: false, reason: 'two_factor_required' });
    const direct = await signIn('google', idToken('google', { sub, email: u.email }));
    expect(direct).toMatchObject({ ok: false, reason: 'two_factor_required' });
    if (direct.ok || direct.reason !== 'two_factor_required') throw new Error('unreachable');
    expect((await app.completeTwoFactor(direct.challenge.token, u.code())).ok).toBe(true);
  });

  it('an Apple relay address never links to another account', async () => {
    const owner = addr('relay-owner');
    await emailCodeTokens(owner);
    // The relay address is its own address; the owner's account is untouched.
    const relay = `${randomBytes(6).toString('hex')}@privaterelay.appleid.com`;
    const r = await signIn('apple', idToken('apple', { sub: `a-${suffix}-r2`, email: relay }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.tokens.user.email).toBe(relay);
  });
});

describe('step-up on a bearer session', () => {
  it('names the method, emails a code when that is the method, and stamps the session', async () => {
    const email = addr('stepup');
    const made = await emailCodeTokens(email);
    if (!made.ok) throw new Error('setup');
    // No password and no authenticator: an emailed code.
    expect(await app.startStepUp(made.tokens.user.id, email)).toBe('email');
    const code = lastCode(email);
    const old = new Date(Date.now() - 60 * 60_000);
    await identityDatabase().execute(
      sql`update auth.sessions set step_up_at = ${old.toISOString()}::timestamptz, created_at = ${old.toISOString()}::timestamptz where token = ${made.tokens.accessToken}`,
    );
    expect((await sessions.session(made.tokens.accessToken))?.stepUpAt?.getTime()).toBe(old.getTime());
    const at = await app.stepUp({
      userId: made.tokens.user.id,
      sessionToken: made.tokens.accessToken,
      proof: { method: 'email', code },
    });
    expect((await sessions.session(made.tokens.accessToken))?.stepUpAt?.getTime()).toBe(at.getTime());
    await expect(
      app.stepUp({
        userId: made.tokens.user.id,
        sessionToken: made.tokens.accessToken,
        proof: { method: 'email', code },
      }),
    ).rejects.toMatchObject({ code: 'invalid_code' });
  });

  it('a person with an authenticator steps up with it, not an emailed code', async () => {
    const u = await twoFactorUser('stepup-tf');
    const r = await emailCodeTokens(u.email);
    if (r.ok || r.reason !== 'two_factor_required') throw new Error('expected a challenge');
    const done = await app.completeTwoFactor(r.challenge.token, u.code());
    if (!done.ok) throw new Error('setup');
    expect(await app.startStepUp(u.id, u.email)).toBe('totp');
    await expect(
      app.stepUp({
        userId: u.id,
        sessionToken: done.tokens.accessToken,
        proof: { method: 'email', code: '123456' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(
      app.stepUp({
        userId: u.id,
        sessionToken: done.tokens.accessToken,
        proof: { method: 'totp', code: u.nextCode() },
      }),
    ).resolves.toBeInstanceOf(Date);
  });
});

describe('refresh keeps the step-up', () => {
  it('a refresh carries the access token’s step-up over unchanged', async () => {
    const made = await emailCodeTokens(addr('refresh'));
    if (!made.ok) throw new Error('setup');
    const old = new Date(Date.now() - 30 * 60_000);
    await identityDatabase().execute(
      sql`update auth.sessions set step_up_at = ${old.toISOString()}::timestamptz where token = ${made.tokens.accessToken}`,
    );
    const r = await bearerSessions(auth).refresh(made.tokens.refreshToken);
    if (!r.ok) throw new Error('refresh');
    expect((await sessions.session(r.tokens.accessToken))?.stepUpAt?.getTime()).toBe(old.getTime());
  });
});
