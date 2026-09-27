import { randomBytes } from 'node:crypto';
import { closePools } from '@yayatoh/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuth, memoryMailer } from '../src/index.ts';

const { mailer, sent } = memoryMailer();
const auth = createAuth({
  baseURL: 'https://app.yayatoh.test',
  secret: randomBytes(32).toString('hex'),
  mailer,
});
const suffix = randomBytes(4).toString('hex');

afterAll(closePools);

function sessionCookie(res: Response): { name: string; value: string; raw: string } {
  const raw = res.headers.getSetCookie().find((c) => /^(__Host-)?yy\.session=/.test(c)) ?? '';
  const [pair] = raw.split(';');
  const [name, value] = (pair ?? '').split('=');
  return { name: name ?? '', value: value ?? '', raw };
}

async function credentialHash(userId: string) {
  const ctx = await auth.$context;
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  return accounts.find((a) => a.providerId === 'credential')?.password ?? '';
}

describe('auth (Better Auth on Postgres 18)', () => {
  it('signs up with an Argon2id hash and a host-only __Host- session cookie', async () => {
    const res = await auth.api.signUpEmail({
      body: { email: `new-${suffix}@example.test`, password: 'correct horse battery', name: 'New User' },
      asResponse: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string } };
    expect(await credentialHash(body.user.id)).toMatch(/^\$argon2id\$/);
    const cookie = sessionCookie(res);
    expect(cookie.name).toBe('__Host-yy.session');
    expect(cookie.raw).toMatch(/Secure/i);
    expect(cookie.raw).toMatch(/Path=\//);
    expect(cookie.raw).not.toMatch(/Domain=/i);

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: `${cookie.name}=${cookie.value}` }),
    });
    expect(session?.user.id).toBe(body.user.id);
  });

  it('signs in a migrated Laravel user and rehashes $2y$ to Argon2id', async () => {
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser(
      {
        email: `legacy-${suffix}@example.test`,
        name: 'Legacy',
        emailVerified: true,
      },
      // Migrated users arrive through the ELT (M2); `admin` is the closest provisioning source.
      { method: 'admin' },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    });
    const bad = await auth.api.signInEmail({
      body: { email: user.email, password: 'wrongpass1' },
      asResponse: true,
    });
    expect(bad.status).toBe(401);
    const ok = await auth.api.signInEmail({
      body: { email: user.email, password: 'password' },
      asResponse: true,
    });
    expect(ok.status).toBe(200);
    expect(await credentialHash(user.id)).toMatch(/^\$argon2id\$/);
    const again = await auth.api.signInEmail({
      body: { email: user.email, password: 'password' },
      asResponse: true,
    });
    expect(again.status).toBe(200);
  });

  it('signs in with an emailed one-time code', async () => {
    const email = `otp-${suffix}@example.test`;
    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
    const otp = sent.findLast((m) => m.to === email && m.kind === 'otp')?.value;
    expect(otp).toMatch(/^\d{6}$/);
    const res = await auth.api.signInEmailOTP({ body: { email, otp: otp as string }, asResponse: true });
    expect(res.status).toBe(200);
    expect(sessionCookie(res).value).not.toBe('');
  });
});
