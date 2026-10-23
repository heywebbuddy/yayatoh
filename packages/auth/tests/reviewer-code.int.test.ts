import { randomBytes } from 'node:crypto';
import { closePools } from '@yayatoh/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { appSignIn, createAuth, fakeIdTokenVerifier, memoryMailer, twoFactorService } from '../src/index.ts';

/** The reviewer demo's fixed email code (M7.5a): one address, non-production only. */
const { mailer, sent } = memoryMailer();
const secret = randomBytes(32).toString('hex');
const suffix = randomBytes(4).toString('hex');
const REVIEWER = `app-review-${suffix}@yayatoh.test`;
const CODE = '424242';

function host(port: number, fixed?: Record<string, string>) {
  const auth = createAuth({
    baseURL: `http://localhost:${port}`,
    secret,
    mailer,
    ...(fixed ? { fixedEmailCodes: fixed } : {}),
  });
  const verifier = fakeIdTokenVerifier({
    secret: 'a'.repeat(64),
    audiences: { apple: ['a'], google: ['g'] },
  });
  return appSignIn(auth, { mailer, twoFactor: twoFactorService(auth, { mailer }), verifier });
}
const lastCode = (to: string) =>
  [...sent].reverse().find((m) => m.to === to && m.kind === 'otp')?.value ?? '';

afterAll(closePools);

describe('fixed email code for the reviewer demo', () => {
  const app = host(3996, { [REVIEWER]: CODE });

  it('emails the fixed code to that address every time, and signs in with it', async () => {
    await app.requestEmailCode(REVIEWER);
    expect(lastCode(REVIEWER)).toBe(CODE);
    const first = await app.signInWithEmailCode(REVIEWER, CODE);
    expect(first.ok).toBe(true);
    await app.requestEmailCode(REVIEWER.toUpperCase());
    expect(lastCode(REVIEWER)).toBe(CODE);
    expect((await app.signInWithEmailCode(REVIEWER, CODE)).ok).toBe(true);
  });

  it('keeps everyone else on random codes', async () => {
    const other = `someone-${suffix}@example.test`;
    await app.requestEmailCode(other);
    expect(lastCode(other)).toMatch(/^\d{6}$/);
    expect(lastCode(other)).not.toBe(CODE);
    expect((await app.signInWithEmailCode(other, CODE)).ok).toBe(false);
  });

  it('is ignored in production, even if a host passes it', async () => {
    vi.stubEnv('YAYATOH_ENV', 'production');
    try {
      const prod = host(3995, { [REVIEWER]: CODE });
      const seen = new Set<string>();
      for (let i = 0; i < 3; i++) {
        await prod.requestEmailCode(REVIEWER);
        seen.add(lastCode(REVIEWER));
      }
      expect(seen.has(CODE) && seen.size === 1).toBe(false);
      expect([...seen].every((c) => /^\d{6}$/.test(c))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
