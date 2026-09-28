import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { closePools } from '@yayatoh/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CODE_ATTEMPTS,
  createAuth,
  memoryMailer,
  type SecretSealer,
  TwoFactorError,
  twoFactorService,
  verifySignInChallenge,
} from '../src/index.ts';
import { sessions } from '../src/schema.ts';
import { base32Decode, secretKey, setupKey, totp } from '../src/totp.ts';

/** A stand-in for the platform KeyVault: AES-256-GCM with a per-run key. */
function testSealer(): SecretSealer {
  const key = randomBytes(32);
  return {
    async seal(plaintext: string) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return `test.v1.${iv.toString('base64url')}.${body.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
    },
    async open(sealed: string) {
      const [scheme, v, iv, body, tag] = sealed.split('.');
      if (scheme !== 'test' || v !== 'v1' || !iv || !body || !tag) throw new Error('not sealed');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
    },
  };
}

const BASE = 'http://localhost:3999';
const sealer = testSealer();
const { mailer, sent } = memoryMailer();
const auth = createAuth({ baseURL: BASE, secret: randomBytes(32).toString('hex'), mailer, sealer });
const tf = twoFactorService(auth, { mailer });
const suffix = randomBytes(4).toString('hex');
const PASSWORD = 'correct horse battery staple';

afterAll(closePools);

/** Minimal cookie jar: Set-Cookie → Cookie header. */
function jar() {
  const cookies = new Map<string, string>();
  return {
    take(res: Response) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair, ...attrs] = raw.split(';');
        const eqAt = (pair ?? '').indexOf('=');
        const name = (pair ?? '').slice(0, eqAt).trim();
        const value = (pair ?? '').slice(eqAt + 1).trim();
        const expired = attrs.some((a) => /max-age=0/i.test(a)) || value === '';
        if (expired) cookies.delete(name);
        else cookies.set(name, value);
      }
      return res;
    },
    has: (name: string) => cookies.has(name),
    headers: () => new Headers({ cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }),
  };
}

async function newUser(label: string) {
  const email = `${label}-${suffix}-${randomBytes(2).toString('hex')}@example.test`;
  const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: label } });
  // Verified, like every real account (email code or invitation). Better Auth's path for an
  // unverified password account signing in by email code is not exercised here.
  await (await auth.$context).internalAdapter.updateUser(res.user.id, { emailVerified: true });
  return { id: res.user.id, email };
}

/** Enrol a user with a known secret (as the dev seed does) and return it. */
async function enrolled(label: string) {
  const u = await newUser(label);
  const secret = `S${randomBytes(12).toString('hex')}`.slice(0, 20);
  await tf.begin(u.id, u.email, { secret });
  // Confirmed with the previous step's code (still inside the window), so the current code is
  // unused for the test: each code works once (replay protection).
  const { backupCodes } = await tf.confirm(u.id, totp(secretKey(secret), Date.now() - 30_000));
  return {
    ...u,
    secret,
    backupCodes,
    code: () => totp(secretKey(secret), Date.now()),
    /** The next time step's code (accepted one step early): a second fresh code right now. */
    nextCode: () => totp(secretKey(secret), Date.now() + 30_000),
  };
}

async function passwordSignIn(email: string) {
  const j = jar();
  const res = j.take(await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true }));
  return { j, res, body: (await res.json()) as { twoFactorRedirect?: boolean; token?: string } };
}

const actions = async (userId: string) => (await tf.events(userId, 50)).map((e) => e.action);

describe('two-step verification: enrolment', () => {
  it('turns on only after a correct code, and hands out ten backup codes once', async () => {
    const u = await newUser('enrol');
    expect(await tf.status(u.id)).toMatchObject({ enabled: false, pending: false, method: 'password' });
    const { setupKey: key, uri } = await tf.begin(u.id, u.email);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Yayatoh:/);
    expect(new URL(uri).searchParams.get('secret')).toBe(key.replace(/ /g, ''));
    expect(await tf.status(u.id)).toMatchObject({ enabled: false, pending: true });

    await expect(tf.confirm(u.id, '000000')).rejects.toMatchObject({ code: 'invalid_code' });
    const code = totp(base32Decode(key), Date.now());
    const { backupCodes } = await tf.confirm(u.id, code);
    expect(backupCodes).toHaveLength(10);
    expect(await tf.status(u.id)).toMatchObject({
      enabled: true,
      pending: false,
      backupCodesLeft: 10,
      method: 'totp',
    });
    await expect(tf.begin(u.id, u.email)).rejects.toMatchObject({ code: 'already_enabled' });
    await expect(tf.confirm(u.id, code)).rejects.toMatchObject({ code: 'not_pending' });
    expect(await actions(u.id)).toEqual(
      expect.arrayContaining(['two_factor.setup_started', 'two_factor.enabled']),
    );
  });

  it('stores the seed and backup codes sealed: no plaintext secret or code in the database', async () => {
    const u = await enrolled('atrest');
    const [row] = await identityDatabase().execute<{ secret: string; backup_codes: string }>(
      sql`select secret, backup_codes from auth.two_factors where user_id = ${u.id}`,
    );
    expect(row).toBeDefined();
    const stored = `${row?.secret} ${row?.backup_codes}`;
    expect(row?.secret.startsWith('test.v1.')).toBe(true);
    expect(row?.backup_codes.startsWith('test.v1.')).toBe(true);
    expect(stored).not.toContain(u.secret);
    expect(stored).not.toContain(setupKey(u.secret).replace(/ /g, ''));
    for (const c of u.backupCodes) expect(stored).not.toContain(c);
    // Opening the envelope yields Better Auth's own ciphertext, not the seed either.
    expect(await sealer.open(row?.secret ?? '')).not.toContain(u.secret);
  });
});

describe('two-step verification: sign-in challenge', () => {
  it('a password sign-in gets no session until a correct code', async () => {
    const u = await enrolled('challenge');
    const { j, body } = await passwordSignIn(u.email);
    expect(body.twoFactorRedirect).toBe(true);
    expect(j.has('yy.session_token') || j.has('yy.session')).toBe(false);
    expect(j.has('yy.two_factor')).toBe(true);

    await expect(
      auth.api.verifyTOTP({ body: { code: '000000' }, headers: j.headers() }),
    ).rejects.toMatchObject({ statusCode: 401 });
    const ok = j.take(
      await auth.api.verifyTOTP({ body: { code: u.code() }, headers: j.headers(), asResponse: true }),
    );
    expect(ok.status).toBe(200);
    expect(j.has('yy.session')).toBe(true);
    const session = await auth.api.getSession({ headers: j.headers() });
    expect(session?.user.id).toBe(u.id);
    expect(await actions(u.id)).toContain('two_factor.challenge_passed');
  });

  it('limits wrong codes per challenge: after five, the sign-in must start again', async () => {
    const u = await enrolled('attempts');
    const { j } = await passwordSignIn(u.email);
    for (let i = 0; i < 5; i++)
      await expect(
        auth.api.verifyTOTP({ body: { code: '000000' }, headers: j.headers() }),
      ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      auth.api.verifyTOTP({ body: { code: u.code() }, headers: j.headers() }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('an emailed code is one factor too: the challenge follows', async () => {
    const u = await enrolled('otp');
    await auth.api.sendVerificationOTP({ body: { email: u.email, type: 'sign-in' } });
    const otp = sent.findLast((m) => m.to === u.email && m.kind === 'otp')?.value ?? '';
    const j = jar();
    const res = j.take(await auth.api.signInEmailOTP({ body: { email: u.email, otp }, asResponse: true }));
    expect(((await res.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect(j.has('yy.session')).toBe(false);
    j.take(await auth.api.verifyTOTP({ body: { code: u.code() }, headers: j.headers(), asResponse: true }));
    expect((await auth.api.getSession({ headers: j.headers() }))?.user.id).toBe(u.id);
  });

  it('a magic link is one factor too: back to the sign-in page for the code, with no session', async () => {
    const u = await enrolled('magic');
    await auth.api.signInMagicLink({ body: { email: u.email }, headers: new Headers() });
    const link = new URL(sent.findLast((m) => m.to === u.email && m.kind === 'link')?.value ?? '');
    const j = jar();
    const res = j.take(
      await auth.api.magicLinkVerify({
        query: { token: link.searchParams.get('token') ?? '', callbackURL: '/o' },
        headers: new Headers(),
        asResponse: true,
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/sign-in?challenge=1');
    expect(j.has('yy.session')).toBe(false);
    expect(j.has('yy.two_factor')).toBe(true);
  });

  it('a backup code signs in once, then is spent', async () => {
    const u = await enrolled('backup');
    const [code] = u.backupCodes;
    const first = await passwordSignIn(u.email);
    first.j.take(
      await auth.api.verifyBackupCode({
        body: { code: code ?? '' },
        headers: first.j.headers(),
        asResponse: true,
      }),
    );
    expect((await auth.api.getSession({ headers: first.j.headers() }))?.user.id).toBe(u.id);
    const second = await passwordSignIn(u.email);
    await expect(
      auth.api.verifyBackupCode({ body: { code: code ?? '' }, headers: second.j.headers() }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect((await tf.status(u.id)).backupCodesLeft).toBe(9);
    expect(await actions(u.id)).toEqual(
      expect.arrayContaining(['two_factor.backup_code_used', 'two_factor.challenge_passed']),
    );
  });

  it('Better Auth’s own two-factor endpoints are closed over HTTP', async () => {
    for (const path of ['enable', 'disable', 'verify-totp', 'generate-backup-codes', 'get-totp-uri']) {
      const res = await auth.handler(
        new Request(`${BASE}/api/auth/two-factor/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: BASE },
          body: JSON.stringify({ password: PASSWORD, code: '123456' }),
        }),
      );
      expect(res.status).toBe(404);
    }
  });
});

describe('two-step verification: step-up, turning off, backup codes', () => {
  async function signedIn(u: { email: string; code?: () => string }) {
    const { j, body } = await passwordSignIn(u.email);
    if (body.twoFactorRedirect && u.code)
      j.take(await auth.api.verifyTOTP({ body: { code: u.code() }, headers: j.headers(), asResponse: true }));
    const s = await auth.api.getSession({ headers: j.headers() });
    if (!s) throw new Error('no session');
    return Object.assign(s.session.token, { j });
  }
  const stepUpAt = async (token: string) =>
    (
      await identityDatabase()
        .select({ at: sessions.stepUpAt })
        .from(sessions)
        .where(eq(sessions.token, token))
    )[0]?.at ?? null;

  it('an authenticator user steps up with a code (or a backup code), never a password', async () => {
    const u = await enrolled('stepup');
    const token = await signedIn(u);
    expect(await tf.method(u.id)).toBe('totp');
    await expect(
      tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'password', password: PASSWORD } }),
    ).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(
      tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'totp', code: '000000' } }),
    ).rejects.toMatchObject({ code: 'invalid_code' });
    expect(await stepUpAt(token)).toBeNull();
    // The sign-in spent the current code: a step-up needs a later one (replay protection).
    await expect(
      tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'totp', code: u.code() } }),
    ).rejects.toMatchObject({ code: 'invalid_code' });
    const at = await tf.stepUp({
      userId: u.id,
      sessionToken: token,
      proof: { method: 'totp', code: u.nextCode() },
    });
    expect((await stepUpAt(token))?.getTime()).toBe(at.getTime());
    // The session reports it (the web builds ctx.stepUpAt from it).
    const s = await auth.api.getSession({ headers: token.j.headers() });
    expect(new Date(s?.session.stepUpAt ?? 0).getTime()).toBe(at.getTime());
    const backup = u.backupCodes[1] ?? '';
    await tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'totp', code: backup } });
    await expect(
      tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'totp', code: backup } }),
    ).rejects.toMatchObject({ code: 'invalid_code' });
    expect(await actions(u.id)).toEqual(
      expect.arrayContaining(['step_up.confirmed', 'step_up.failed', 'two_factor.backup_code_used']),
    );
  });

  it('a person without 2FA steps up with their password; without a password, with an emailed code', async () => {
    const u = await newUser('pwd');
    const token = await signedIn(u);
    expect(await tf.method(u.id)).toBe('password');
    await expect(
      tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'password', password: 'nope-nope' } }),
    ).rejects.toMatchObject({ code: 'invalid_password' });
    await tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'password', password: PASSWORD } });
    expect(await stepUpAt(token)).not.toBeNull();

    // Code-only account (invited people sign in with an emailed code).
    const email = `codeonly-${suffix}@example.test`;
    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
    const otp = sent.findLast((m) => m.to === email && m.kind === 'otp')?.value ?? '';
    const j = jar();
    j.take(await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true }));
    const s = await auth.api.getSession({ headers: j.headers() });
    const userId = s?.user.id ?? '';
    expect(await tf.method(userId)).toBe('email');
    await tf.sendStepUpEmail(userId, email);
    const code = sent.findLast((m) => m.to === email && m.kind === 'otp')?.value ?? '';
    expect(code).toMatch(/^\d{6}$/);
    await expect(
      tf.stepUp({
        userId,
        sessionToken: s?.session.token ?? '',
        proof: { method: 'email', code: code === '000000' ? '111111' : '000000' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_code' });
    await tf.stepUp({ userId, sessionToken: s?.session.token ?? '', proof: { method: 'email', code } });
    // Single use.
    await expect(
      tf.stepUp({ userId, sessionToken: s?.session.token ?? '', proof: { method: 'email', code } }),
    ).rejects.toMatchObject({ code: 'invalid_code' });
  });

  it(`pauses after ${CODE_ATTEMPTS} wrong codes, even for the right one`, async () => {
    const u = await enrolled('limit');
    const token = await signedIn(u);
    for (let i = 0; i < CODE_ATTEMPTS; i++)
      await expect(
        tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'totp', code: '000000' } }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(
      tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'totp', code: u.code() } }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(tf.disable(u.id, u.code())).rejects.toBeInstanceOf(TwoFactorError);
  });

  it('turning off needs a current code; new backup codes replace the old ones', async () => {
    const u = await enrolled('off');
    const fresh = await tf.regenerateBackupCodes(u.id);
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(u.backupCodes[0]);
    await expect(tf.disable(u.id, u.backupCodes[0] ?? '')).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(tf.disable(u.id, '000000')).rejects.toMatchObject({ code: 'invalid_code' });
    expect((await tf.status(u.id)).enabled).toBe(true);
    await tf.disable(u.id, fresh[0] ?? '');
    expect(await tf.status(u.id)).toMatchObject({ enabled: false, pending: false, method: 'password' });
    await expect(tf.disable(u.id, u.code())).rejects.toMatchObject({ code: 'not_enabled' });
    const [row] = await identityDatabase().execute<{ n: number }>(
      sql`select count(*)::int as n from auth.two_factors where user_id = ${u.id}`,
    );
    expect(row?.n).toBe(0);
    // Signing in no longer asks for a code.
    expect((await passwordSignIn(u.email)).body.twoFactorRedirect).toBeUndefined();
    expect(await actions(u.id)).toEqual(
      expect.arrayContaining(['two_factor.backup_codes_regenerated', 'two_factor.disabled']),
    );
  });
});

describe('TOTP replay protection (M1.2c leftover)', () => {
  it('a sign-in code works once: the same code is refused for a second sign-in within its window', async () => {
    const u = await enrolled('replay-signin');
    const code = u.code();
    const first = await passwordSignIn(u.email);
    expect(first.body.twoFactorRedirect).toBe(true);
    const ok = await verifySignInChallenge(auth, first.j.headers(), { kind: 'totp', code });
    expect(ok).toMatchObject({ ok: true, userId: u.id });
    const second = await passwordSignIn(u.email);
    const replay = await verifySignInChallenge(auth, second.j.headers(), { kind: 'totp', code });
    expect(replay).toEqual({ ok: false, error: 'invalid_code' });
    // A later code still works for that challenge.
    const later = await verifySignInChallenge(auth, second.j.headers(), { kind: 'totp', code: u.nextCode() });
    expect(later).toMatchObject({ ok: true });
    expect(await actions(u.id)).toContain('two_factor.replay_refused');
  });

  it('a right code refused for another reason is not spent', async () => {
    const u = await enrolled('replay-spent');
    const first = await passwordSignIn(u.email);
    for (let i = 0; i < CODE_ATTEMPTS; i++)
      await verifySignInChallenge(auth, first.j.headers(), { kind: 'totp', code: '000000' });
    const spent = await verifySignInChallenge(auth, first.j.headers(), { kind: 'totp', code: u.code() });
    expect(spent.ok).toBe(false);
    const again = await passwordSignIn(u.email);
    expect(
      await verifySignInChallenge(auth, again.j.headers(), { kind: 'totp', code: u.code() }),
    ).toMatchObject({
      ok: true,
    });
  });

  it('step-up and turning off refuse a code already used, and an older one', async () => {
    const u = await enrolled('replay-stepup');
    const s = await passwordSignIn(u.email);
    const r = await verifySignInChallenge(auth, s.j.headers(), { kind: 'totp', code: u.code() });
    expect(r.ok).toBe(true);
    const token = (await auth.api.getSession({ headers: s.j.headers() }))?.session.token ?? '';
    const previous = totp(secretKey(u.secret), Date.now() - 30_000);
    for (const code of [u.code(), previous])
      await expect(
        tf.stepUp({ userId: u.id, sessionToken: token, proof: { method: 'totp', code } }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(tf.disable(u.id, u.code())).rejects.toMatchObject({ code: 'invalid_code' });
    await tf.disable(u.id, u.nextCode());
    expect((await tf.status(u.id)).enabled).toBe(false);
  });

  it('two requests with the same code: exactly one signs in', async () => {
    const u = await enrolled('replay-race');
    const [a, b] = await Promise.all([passwordSignIn(u.email), passwordSignIn(u.email)]);
    const code = u.code();
    const results = await Promise.all([
      verifySignInChallenge(auth, a.j.headers(), { kind: 'totp', code }),
      verifySignInChallenge(auth, b.j.headers(), { kind: 'totp', code }),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
  });
});
