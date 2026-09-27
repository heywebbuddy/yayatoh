import { withoutTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { uuidv7 } from '@yayatoh/kernel';
import { postgresRateLimitStore, purgeRateLimits } from '@yayatoh/platform';
import { createRateLimiter, memoryRateLimitStore, RATE_LIMIT_POLICIES } from '@yayatoh/platform/security';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

afterAll(closePools);

async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err).not.toBeNull();
  expect(`${err?.message} ${err?.cause?.message ?? ''}`).toMatch(re);
}

describe('rate limiter: Postgres store', () => {
  it('matches the in-memory algorithm hit for hit (incl. Retry-After)', async () => {
    const mem = memoryRateLimitStore();
    const key = `test:${uuidv7()}`;
    const rule = { limit: 5, windowMs: 10_000 };
    const base = 1_000_000_000_000;
    // Bursts, a window boundary, decay and a stale window.
    const times = [
      0, 10, 20, 30, 40, 50, 60, 9_990, 10_050, 10_500, 13_000, 17_000, 19_999, 45_000, 45_001,
    ].map((t) => base + t);
    for (const t of times) {
      const [pg, m] = await Promise.all([postgresRateLimitStore.hit(key, rule, t), mem.hit(key, rule, t)]);
      expect(pg, `at +${t - base}`).toEqual(m);
    }
  });

  it('is atomic under concurrency: exactly `limit` of 40 parallel hits pass', async () => {
    const key = `test:${uuidv7()}`;
    const rule = { limit: 7, windowMs: 60_000 };
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 40 }, () => postgresRateLimitStore.hit(key, rule, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(7);
    expect(results.filter((r) => !r.allowed).every((r) => r.retryAfterMs > 0)).toBe(true);
  });

  it('drives a policy end to end through the limiter', async () => {
    const rl = createRateLimiter(postgresRateLimitStore);
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
    const identity = `${uuidv7()}@rate.test`;
    const { limit } = RATE_LIMIT_POLICIES.otpSend.identity;
    for (let i = 0; i < limit; i++) expect((await rl.check('otpSend', { ip, identity })).allowed).toBe(true);
    const denied = await rl.check('otpSend', { ip, identity });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('app_user cannot read or write the table directly; only the function', async () => {
    await rejectsWith(
      withoutTenant((tx) => tx.execute(sql`select * from platform.rate_limit_windows limit 1`)),
      /permission denied/,
    );
    await rejectsWith(
      withoutTenant((tx) =>
        tx.execute(sql`insert into platform.rate_limit_windows values ('x', 1, 0, 0, 0, now())`),
      ),
      /permission denied/,
    );
    await expect(postgresRateLimitStore.hit('', { limit: 1, windowMs: 1 }, 0)).rejects.toThrow();
  });

  it('keys hold no raw identity', async () => {
    const rl = createRateLimiter(postgresRateLimitStore);
    const identity = `secret-${uuidv7()}@rate.test`;
    await rl.check('signIn', { ip: '198.51.100.7', identity });
    const { adminClient } = await import('@yayatoh/db/testing');
    const admin = adminClient();
    try {
      const rows = await admin`select key from platform.rate_limit_windows where key like ${'%secret-%'}`;
      expect(rows).toHaveLength(0);
    } finally {
      await admin.end();
    }
  });

  it('purges expired counters', async () => {
    await postgresRateLimitStore.hit(`test:${uuidv7()}`, { limit: 1, windowMs: 1 }, 1_000);
    expect(await purgeRateLimits()).toBeGreaterThanOrEqual(1);
  });
});
