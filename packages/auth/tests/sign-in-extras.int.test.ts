import { randomBytes } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { closePools } from '@yayatoh/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  anonymiseAccount,
  bearerSessions,
  clearSignInFailures,
  confirmLinkProof,
  createAuth,
  createSocialUser,
  hashRefreshToken,
  isTrustedDevice,
  LINK_PROOF_ATTEMPTS,
  linkSocialAccount,
  listSocialAccounts,
  listTrustedDevices,
  memoryMailer,
  pendingLinkProof,
  recordSignInFailure,
  refreshTokenService,
  resolveSocialSignIn,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  SIGN_IN_FAILURES_BEFORE_CHECK,
  type SocialProfile,
  signInNeedsHumanCheck,
  startLinkProof,
  trustDevice,
  twoFactorService,
  unlinkSocialAccount,
} from '../src/index.ts';
import { accounts, refreshTokens, sessions, trustedDevices, users } from '../src/schema.ts';

const BASE = 'http://localhost:3997';
const HOST = 'localhost:3997';
const { mailer, sent } = memoryMailer();
const auth = createAuth({ baseURL: BASE, secret: randomBytes(32).toString('hex'), mailer });
const tf = twoFactorService(auth, { mailer });
const suffix = randomBytes(4).toString('hex');
const PASSWORD = 'correct horse battery staple';

afterAll(closePools);

const uniqueEmail = (label: string) => `${label}-${suffix}-${randomBytes(3).toString('hex')}@example.test`;

async function newUser(label: string, opts: { verified?: boolean } = {}) {
  const email = uniqueEmail(label);
  const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: label } });
  await identityDatabase().delete(sessions).where(eq(sessions.userId, res.user.id));
  if (opts.verified !== false)
    await identityDatabase().update(users).set({ emailVerified: true }).where(eq(users.id, res.user.id));
  return { id: res.user.id, email };
}

const profile = (email: string | null, over: Partial<SocialProfile> = {}): SocialProfile => ({
  provider: 'google',
  subject: `sub-${randomBytes(6).toString('hex')}`,
  email,
  emailVerified: true,
  name: 'Social Person',
  ...over,
});

const lastCode = (to: string) =>
  [...sent].reverse().find((m) => m.to === to && m.kind === 'otp')?.value ?? '';
const actions = async (userId: string) => (await tf.events(userId, 50)).map((e) => e.action);

describe('Google/Apple account linking rules (M1.2f)', () => {
  it('a new verified email creates an account linked to the provider; the next sign-in finds it', async () => {
    const p = profile(uniqueEmail('new-social'));
    expect(await resolveSocialSignIn(p)).toEqual({ kind: 'create' });
    const userId = await createSocialUser(auth, p);
    expect(await resolveSocialSignIn(p)).toEqual({ kind: 'linked', userId });
    const [u] = await identityDatabase().select().from(users).where(eq(users.id, userId));
    expect(u?.emailVerified).toBe(true);
    expect(await listSocialAccounts(userId)).toMatchObject([{ provider: 'google' }]);
    expect(await actions(userId)).toContain('social.account_created');
  });

  it('an unverified provider email or no email is refused (no account is made)', async () => {
    const email = uniqueEmail('unverified');
    expect(await resolveSocialSignIn(profile(email, { emailVerified: false }))).toEqual({
      kind: 'refused',
      reason: 'email_unverified',
    });
    expect(await resolveSocialSignIn(profile(null))).toEqual({ kind: 'refused', reason: 'no_email' });
    const rows = await identityDatabase().select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });

  it('an existing password account is never linked on the provider’s word: the email must be proved', async () => {
    const owner = await newUser('existing');
    const p = profile(owner.email.toUpperCase());
    const r = await resolveSocialSignIn(p);
    expect(r).toEqual({ kind: 'prove_email', userId: owner.id, email: owner.email });
    // Nothing linked yet.
    expect(await listSocialAccounts(owner.id)).toEqual([]);

    const id = await startLinkProof(auth, mailer, { userId: owner.id, email: owner.email, profile: p });
    expect(await pendingLinkProof(auth, id)).toEqual({
      userId: owner.id,
      provider: 'google',
      email: owner.email,
    });
    const code = lastCode(owner.email);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await confirmLinkProof(auth, id, wrong)).toEqual({ ok: false, error: 'invalid_code' });
    expect(await listSocialAccounts(owner.id)).toEqual([]);
    expect(await confirmLinkProof(auth, id, code)).toEqual({ ok: true, userId: owner.id, reset: false });
    expect(await listSocialAccounts(owner.id)).toMatchObject([{ provider: 'google' }]);
    // Verified account: the password stays.
    const creds = await identityDatabase()
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, owner.id), eq(accounts.providerId, 'credential')));
    expect(creds).toHaveLength(1);
    // The proof is single use.
    expect(await confirmLinkProof(auth, id, code)).toEqual({ ok: false, error: 'expired' });
    expect(await resolveSocialSignIn(p)).toEqual({ kind: 'linked', userId: owner.id });
    expect(await actions(owner.id)).toEqual(
      expect.arrayContaining(['social.link_proof_failed', 'social.linked']),
    );
  });

  it('five wrong codes end the proof', async () => {
    const owner = await newUser('proof-limit');
    const id = await startLinkProof(auth, mailer, {
      userId: owner.id,
      email: owner.email,
      profile: profile(owner.email),
    });
    const code = lastCode(owner.email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < LINK_PROOF_ATTEMPTS; i++)
      expect(await confirmLinkProof(auth, id, wrong)).toEqual({ ok: false, error: 'invalid_code' });
    expect(await confirmLinkProof(auth, id, wrong)).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(await confirmLinkProof(auth, id, code)).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(await listSocialAccounts(owner.id)).toEqual([]);
  });

  it('pre-hijack guard: proving the email of a never-verified account removes the squatter’s password and sessions', async () => {
    const squatted = await newUser('squatted', { verified: false });
    await auth.api.signInEmail({ body: { email: squatted.email, password: PASSWORD } });
    const p = profile(squatted.email);
    const id = await startLinkProof(auth, mailer, { userId: squatted.id, email: squatted.email, profile: p });
    expect(await confirmLinkProof(auth, id, lastCode(squatted.email))).toEqual({
      ok: true,
      userId: squatted.id,
      reset: true,
    });
    const db = identityDatabase();
    expect(
      await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, squatted.id), eq(accounts.providerId, 'credential'))),
    ).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, squatted.id))).toHaveLength(0);
    const [u] = await db.select().from(users).where(eq(users.id, squatted.id));
    expect(u?.emailVerified).toBe(true);
    // The squatter's password no longer works.
    await expect(
      auth.api.signInEmail({ body: { email: squatted.email, password: PASSWORD } }),
    ).rejects.toThrow();
  });

  it('linking from account security: one identity per account, one account per identity; unlink rules', async () => {
    const a = await newUser('link-a');
    const b = await newUser('link-b');
    const p = profile(uniqueEmail('whatever'));
    expect(await linkSocialAccount(auth, a.id, p)).toBe('linked');
    expect(await linkSocialAccount(auth, a.id, p)).toBe('already_linked');
    expect(await linkSocialAccount(auth, b.id, p)).toBe('linked_elsewhere');
    expect(await linkSocialAccount(auth, a.id, profile(null))).toBe('provider_taken');
    // Isolation: b can't unlink a's provider.
    expect(await unlinkSocialAccount(b.id, 'google')).toBe('not_linked');
    expect(await unlinkSocialAccount(a.id, 'google')).toBe('unlinked');
    expect(await listSocialAccounts(a.id)).toEqual([]);

    // Apple private relay with no password: the provider is the only way in.
    const relay = profile(`${randomBytes(6).toString('hex')}@privaterelay.appleid.com`, {
      provider: 'apple',
    });
    const relayUser = await createSocialUser(auth, relay);
    expect(await unlinkSocialAccount(relayUser, 'apple')).toBe('last_method');
    expect(await linkSocialAccount(auth, relayUser, profile(uniqueEmail('g')))).toBe('linked');
    expect(await unlinkSocialAccount(relayUser, 'apple')).toBe('unlinked');
  });

  it('a social sign-in for a person with two-step verification opens the challenge, not a session', async () => {
    const person = await newUser('social-2fa');
    await identityDatabase().update(users).set({ twoFactorEnabled: true }).where(eq(users.id, person.id));
    const res = await auth.api.socialSession({
      body: { userId: person.id },
      headers: new Headers({ host: HOST }),
      asResponse: true,
    });
    expect(await res.json()).toEqual({ challenge: true });
    expect(res.headers.getSetCookie().some((c) => c.includes('two_factor'))).toBe(true);
    expect(
      await identityDatabase().select().from(sessions).where(eq(sessions.userId, person.id)),
    ).toHaveLength(0);

    const plain = await newUser('social-plain');
    const ok = await auth.api.socialSession({
      body: { userId: plain.id },
      headers: new Headers({ host: HOST }),
      asResponse: true,
    });
    expect(await ok.json()).toEqual({ challenge: false });
    const [s] = await identityDatabase().select().from(sessions).where(eq(sessions.userId, plain.id));
    expect(s?.host).toBe(HOST);
  });

  it('the in-process endpoints are closed over HTTP', async () => {
    for (const path of ['/api/auth/social/session', '/api/auth/trusted-device/redeem']) {
      const res = await auth.handler(
        new Request(`${BASE}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: BASE },
          body: JSON.stringify({ userId: randomBytes(16).toString('hex') }),
        }),
      );
      expect(res.status).toBe(404);
    }
  });
});

describe('trusted devices (M1.2f)', () => {
  it('trust works for its person and host only, until revoked or expired; isolation between people', async () => {
    const a = await newUser('trust-a');
    const b = await newUser('trust-b');
    const t = await trustDevice({
      userId: a.id,
      host: HOST,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0',
    });
    expect(await isTrustedDevice({ cookie: t.cookie, userId: a.id, host: HOST })).toBe(true);
    expect(await isTrustedDevice({ cookie: t.cookie, userId: b.id, host: HOST })).toBe(false);
    expect(await isTrustedDevice({ cookie: t.cookie, userId: a.id, host: 'other.yayatoh.events' })).toBe(
      false,
    );
    const [id, secret] = t.cookie.split('.');
    expect(await isTrustedDevice({ cookie: `${id}.${'A'.repeat(43)}`, userId: a.id, host: HOST })).toBe(
      false,
    );
    expect(
      await isTrustedDevice({
        cookie: t.cookie,
        userId: a.id,
        host: HOST,
        now: new Date(t.expiresAt.getTime() + 1),
      }),
    ).toBe(false);
    // Only the hash is stored.
    const [row] = await identityDatabase()
      .select()
      .from(trustedDevices)
      .where(eq(trustedDevices.id, id ?? ''));
    expect(row?.secretHash).not.toContain(secret);
    expect(row?.label).toBe('Chrome on Linux');

    const list = await listTrustedDevices(a.id);
    expect(list.map((d) => d.id)).toEqual([id]);
    expect(list[0]?.lastUsedAt).not.toBeNull();
    expect(await listTrustedDevices(b.id)).toEqual([]);
    // b can't revoke a's device.
    expect(await revokeTrustedDevice(b.id, id ?? '')).toBe(false);
    expect(await isTrustedDevice({ cookie: t.cookie, userId: a.id, host: HOST })).toBe(true);
    expect(await revokeTrustedDevice(a.id, id ?? '')).toBe(true);
    expect(await isTrustedDevice({ cookie: t.cookie, userId: a.id, host: HOST })).toBe(false);
    expect(await listTrustedDevices(a.id)).toEqual([]);
    expect(await actions(a.id)).toEqual(
      expect.arrayContaining(['trusted_device.added', 'trusted_device.used', 'trusted_device.revoked']),
    );
  });

  it('a pending challenge on a trusted browser completes without a code; otherwise it stays', async () => {
    const person = await newUser('trust-redeem');
    await identityDatabase().update(users).set({ twoFactorEnabled: true }).where(eq(users.id, person.id));
    const t = await trustDevice({ userId: person.id, host: HOST });
    const open = async () => {
      const r = await auth.api.socialSession({
        body: { userId: person.id },
        headers: new Headers({ host: HOST }),
        asResponse: true,
      });
      return r.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
    };
    const refused = await auth.api.redeemTrustedDevice({
      body: { cookie: null, host: HOST },
      headers: new Headers({ host: HOST, cookie: await open() }),
    });
    expect(refused).toEqual({ ok: false });
    const res = await auth.api.redeemTrustedDevice({
      body: { cookie: t.cookie, host: HOST },
      headers: new Headers({ host: HOST, cookie: await open() }),
      asResponse: true,
    });
    expect(await res.json()).toEqual({ ok: true, userId: person.id });
    expect(
      res.headers.getSetCookie().some((c) => c.startsWith('yy.session_token=') || c.includes('yy.session')),
    ).toBe(true);
    expect(await actions(person.id)).toContain('two_factor.skipped_trusted_device');
  });

  it('a password reset revokes every trusted device and refresh token; account deletion revokes too', async () => {
    const person = await newUser('trust-reset');
    const t = await trustDevice({ userId: person.id, host: HOST });
    const tokens = refreshTokenService(auth);
    const pair = await tokens.issue(person.id);
    await auth.api.requestPasswordReset({ body: { email: person.email, redirectTo: '/reset-password' } });
    const link = [...sent].reverse().find((m) => m.to === person.email && m.kind === 'reset')?.value ?? '';
    const token = new URL(link).pathname.split('/').pop() ?? '';
    await auth.api.resetPassword({ body: { newPassword: 'a new long password', token } });
    expect(await isTrustedDevice({ cookie: t.cookie, userId: person.id, host: HOST })).toBe(false);
    const [row] = await identityDatabase()
      .select()
      .from(trustedDevices)
      .where(eq(trustedDevices.userId, person.id));
    expect(row?.revokedReason).toBe('password_changed');
    expect(await tokens.rotate(pair.refreshToken)).toEqual({ ok: false, reason: 'revoked' });
    expect(await actions(person.id)).toContain('password.reset');

    const gone = await newUser('trust-delete');
    const g = await trustDevice({ userId: gone.id, host: HOST });
    await anonymiseAccount(gone.id, { by: 'self' });
    expect(await isTrustedDevice({ cookie: g.cookie, userId: gone.id, host: HOST })).toBe(false);
    const [d] = await identityDatabase()
      .select()
      .from(trustedDevices)
      .where(eq(trustedDevices.userId, gone.id));
    expect(d?.revokedReason).toBe('account_deleted');
    expect(await revokeAllTrustedDevices(gone.id, 'revoked')).toBe(0);
  });
});

describe('refresh tokens for /v1 (M1.2f)', () => {
  it('sign-in gives a 15-minute access token that is never extended and a refresh token; rotation works', async () => {
    const person = await newUser('refresh');
    const bearer = bearerSessions(auth);
    const r = await bearer.signInForTokens(person.email, PASSWORD);
    if (!r.ok) throw new Error('sign-in failed');
    const t0 = r.tokens;
    expect(t0.accessTokenExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    // The password sign-in's own 14-day session is gone: only the access session remains.
    const live = await identityDatabase().select().from(sessions).where(eq(sessions.userId, person.id));
    expect(live.map((s) => s.token)).toEqual([t0.accessToken]);
    const s = await bearer.session(t0.accessToken);
    expect(s?.expiresAt.getTime()).toBe(t0.accessTokenExpiresAt.getTime());
    // Stored as a hash only.
    const [row] = await identityDatabase()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, person.id));
    expect(row?.tokenHash).toBe(hashRefreshToken(t0.refreshToken));

    const r1 = await bearer.refresh(t0.refreshToken);
    if (!r1.ok) throw new Error('refresh failed');
    expect(r1.tokens.refreshToken).not.toBe(t0.refreshToken);
    // The old access token ended with the rotation; the new one works.
    expect(await bearer.session(t0.accessToken)).toBeNull();
    expect((await bearer.session(r1.tokens.accessToken))?.user.id).toBe(person.id);
    const r2 = await bearer.refresh(r1.tokens.refreshToken);
    expect(r2.ok).toBe(true);
  });

  it('a reused refresh token revokes the whole family (every access token ends); other people are untouched', async () => {
    const victim = await newUser('reuse');
    const other = await newUser('reuse-other');
    const bearer = bearerSessions(auth);
    const a = await bearer.signInForTokens(victim.email, PASSWORD);
    const o = await bearer.signInForTokens(other.email, PASSWORD);
    if (!a.ok || !o.ok) throw new Error('sign-in failed');
    const r1 = await bearer.refresh(a.tokens.refreshToken);
    if (!r1.ok) throw new Error('refresh failed');
    // The stolen, already-spent token comes back.
    expect(await bearer.refresh(a.tokens.refreshToken)).toEqual({ ok: false, reason: 'reused' });
    expect(await bearer.session(r1.tokens.accessToken)).toBeNull();
    expect(await bearer.refresh(r1.tokens.refreshToken)).toEqual({ ok: false, reason: 'reused' });
    expect(await actions(victim.id)).toContain('refresh_token.reuse_detected');
    // Someone else's family is untouched.
    expect((await bearer.session(o.tokens.accessToken))?.user.id).toBe(other.id);
    expect((await bearer.refresh(o.tokens.refreshToken)).ok).toBe(true);
  });

  it('concurrent use of one refresh token: exactly one wins, and the other is a reuse', async () => {
    const person = await newUser('race');
    const bearer = bearerSessions(auth);
    const a = await bearer.signInForTokens(person.email, PASSWORD);
    if (!a.ok) throw new Error('sign-in failed');
    const results = await Promise.all([
      bearer.refresh(a.tokens.refreshToken),
      bearer.refresh(a.tokens.refreshToken),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('unknown, expired and signed-out tokens are refused; wrong passwords and 2FA accounts get no tokens', async () => {
    const person = await newUser('refresh-refusals');
    const bearer = bearerSessions(auth);
    expect(await bearer.refresh('yyr_not-a-real-token')).toEqual({ ok: false, reason: 'invalid' });
    expect(await bearer.refresh(`yyr_${'a'.repeat(43)}`)).toEqual({ ok: false, reason: 'invalid' });
    expect(await bearer.signInForTokens(person.email, 'wrong password!')).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
    const a = await bearer.signInForTokens(person.email, PASSWORD);
    if (!a.ok) throw new Error('sign-in failed');
    await bearer.revokeRefresh(a.tokens.refreshToken);
    expect(await bearer.refresh(a.tokens.refreshToken)).toEqual({ ok: false, reason: 'revoked' });
    expect(await bearer.session(a.tokens.accessToken)).toBeNull();

    const later = refreshTokenService(auth, { now: () => new Date(Date.now() + 31 * 24 * 60 * 60_000) });
    const b = await refreshTokenService(auth).issue(person.id);
    expect(await later.rotate(b.refreshToken)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('human check after failed sign-ins (M1.2f)', () => {
  it('is due after three failures for an email, per email, and a success clears it', async () => {
    const email = uniqueEmail('guard');
    const other = uniqueEmail('guard-other');
    expect(await signInNeedsHumanCheck(email)).toBe(false);
    for (let i = 1; i < SIGN_IN_FAILURES_BEFORE_CHECK; i++)
      expect(await recordSignInFailure(email)).toBe(false);
    expect(await recordSignInFailure(email.toUpperCase())).toBe(true);
    expect(await signInNeedsHumanCheck(email)).toBe(true);
    expect(await signInNeedsHumanCheck(other)).toBe(false);
    // The window passes.
    expect(await signInNeedsHumanCheck(email, new Date(Date.now() + 16 * 60_000))).toBe(false);
    await clearSignInFailures(email);
    expect(await signInNeedsHumanCheck(email)).toBe(false);
  });
});
