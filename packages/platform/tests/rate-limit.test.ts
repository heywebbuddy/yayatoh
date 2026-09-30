import { describe, expect, it, vi } from 'vitest';
import {
  createRateLimiter,
  memoryRateLimitStore,
  newDeviceId,
  RATE_LIMIT_POLICIES,
  retryAfterSeconds,
  slidingWindow,
  tooManyRequests,
  upstashRateLimitStore,
  type WindowState,
} from '../src/security/rate-limit.ts';

const rule = { limit: 10, windowMs: 60_000 };

function run(times: number[], r = rule) {
  let state: WindowState | null = null;
  return times.map((t) => {
    const out = slidingWindow(state, t, r);
    state = out.state;
    return out.decision;
  });
}

describe('sliding window', () => {
  it('allows the limit within a window, then denies with Retry-After', () => {
    const t0 = 600_000; // a window boundary
    const d = run(Array.from({ length: 11 }, (_, i) => t0 + i * 1000));
    expect(d.slice(0, 10).every((x) => x.allowed)).toBe(true);
    expect(d.map((x) => x.remaining).slice(0, 10)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const denied = d[10];
    expect(denied?.allowed).toBe(false);
    // curr = 10 in this window, prev 0: wait for the next window (50 s left) plus decay to 9/10.
    expect(denied?.retryAfterMs).toBe(60_000 - 10_000 + 6_000);
  });

  it('weights the previous window: no 2× burst at a boundary', () => {
    const t0 = 600_000;
    // 10 requests at the very end of one window…
    const first = run(Array.from({ length: 10 }, (_, i) => t0 + 59_000 + i * 10));
    expect(first.every((x) => x.allowed)).toBe(true);
    let state: WindowState | null = null;
    for (let i = 0; i < 10; i++) state = slidingWindow(state, t0 + 59_000 + i * 10, rule).state;
    // …and right after the boundary almost nothing is available.
    const next = slidingWindow(state, t0 + 60_100, rule);
    expect(next.decision.allowed).toBe(false);
    // Retry after is when prev·(1−t/w) + 0 + 1 ≤ 10 → t ≥ 6 s into the window.
    expect(next.decision.retryAfterMs).toBe(6_000 - 100);
    const later = slidingWindow(state, t0 + 60_000 + 6_000, rule);
    expect(later.decision.allowed).toBe(true);
  });

  it('retry-after is exact: one ms earlier is still denied', () => {
    let state: WindowState | null = null;
    for (let i = 0; i < 10; i++) state = slidingWindow(state, 1_000_000 + i, rule).state;
    const denied = slidingWindow(state, 1_000_020, rule).decision;
    const at = 1_000_020 + denied.retryAfterMs;
    expect(slidingWindow(state, at - 1, rule).decision.allowed).toBe(false);
    expect(slidingWindow(state, at, rule).decision.allowed).toBe(true);
  });

  it('denied hits are not counted and a stale window resets', () => {
    let state: WindowState | null = null;
    for (let i = 0; i < 20; i++) state = slidingWindow(state, 1_200_000 + i, rule).state;
    expect(state?.curr).toBe(10);
    expect(slidingWindow(state, 1_200_000 + 10 * 60_000, rule).decision.remaining).toBe(9);
  });

  it('rejects nonsense rules', () => {
    expect(() => slidingWindow(null, 0, { limit: 0, windowMs: 1 })).toThrow();
  });
});

describe('rate limiter', () => {
  it('keys by device, with identity and IP ceilings; device falls back to IP', async () => {
    const store = memoryRateLimitStore();
    const rl = createRateLimiter(store);
    const device = newDeviceId();
    const now = 5_000_000;
    const { limit } = RATE_LIMIT_POLICIES.signIn.device;
    for (let i = 0; i < limit; i++)
      expect(
        (await rl.check('signIn', { device, ip: '203.0.113.9', identity: 'a@x.test' }, { now })).allowed,
      ).toBe(true);
    const denied = await rl.check('signIn', { device, ip: '203.0.113.9', identity: 'a@x.test' }, { now });
    expect(denied.allowed).toBe(false);
    expect(retryAfterSeconds(denied)).toBeGreaterThan(0);
    // Another device on the same (shared) IP is unaffected.
    expect((await rl.check('signIn', { device: newDeviceId(), ip: '203.0.113.9' }, { now })).allowed).toBe(
      true,
    );
    // Scopes separate routes.
    expect((await rl.check('signIn', { device, ip: '203.0.113.9' }, { now, scope: 'otp' })).allowed).toBe(
      true,
    );
  });

  it('the identity bucket stops a spray across devices', async () => {
    const rl = createRateLimiter(memoryRateLimitStore());
    const now = 9_000_000;
    const identity = 'Victim@Example.test ';
    const max = RATE_LIMIT_POLICIES.signIn.identity.limit;
    let allowed = 0;
    for (let i = 0; i < max + 5; i++)
      if (
        (await rl.check('signIn', { device: newDeviceId(), ip: `198.51.100.${i}`, identity }, { now }))
          .allowed
      )
        allowed++;
    expect(allowed).toBe(max);
    // Normalized: case and whitespace don't create new buckets.
    expect(
      (await rl.check('signIn', { device: newDeviceId(), identity: 'victim@example.test' }, { now })).allowed,
    ).toBe(false);
  });

  it('invalid device cookies are ignored (IP bucket applies)', async () => {
    const rl = createRateLimiter(memoryRateLimitStore());
    const now = 1_000;
    const { limit } = RATE_LIMIT_POLICIES.otpSend.anonymousIp;
    for (let i = 0; i < limit; i++)
      await rl.check('otpSend', { device: `bad cookie ${i}`, ip: '192.0.2.1' }, { now });
    expect((await rl.check('otpSend', { device: 'x', ip: '192.0.2.1' }, { now })).allowed).toBe(false);
  });

  it('counts the IP ceiling only when the IP is known', async () => {
    const rl = createRateLimiter(memoryRateLimitStore());
    const now = 77_000_000;
    const { limit } = RATE_LIMIT_POLICIES.webhookAbuse.ipCeiling;
    // Different devices, same known IP: the ceiling applies.
    for (let i = 0; i < limit; i++)
      await rl.check('webhookAbuse', { device: newDeviceId(), ip: '192.0.2.50' }, { now });
    expect(
      (await rl.check('webhookAbuse', { device: newDeviceId(), ip: '192.0.2.50' }, { now })).allowed,
    ).toBe(false);
    // Unknown IP: only the device bucket.
    for (let i = 0; i < limit + 5; i++)
      expect((await rl.check('webhookAbuse', { device: newDeviceId(), ip: null }, { now })).allowed).toBe(
        true,
      );
  });

  it('fails open when the store is down, and reports the error', async () => {
    const onError = vi.fn();
    const rl = createRateLimiter({ hit: () => Promise.reject(new Error('down')) }, onError);
    expect((await rl.check('checkoutStart', { ip: '1.1.1.1' })).allowed).toBe(true);
    expect(onError).toHaveBeenCalled();
  });

  it('builds a 429 with Retry-After', async () => {
    const res = tooManyRequests({ allowed: false, limit: 5, remaining: 0, retryAfterMs: 1_500 });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('2');
    expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 2 });
  });

  it('memory store evicts the oldest keys beyond its cap', async () => {
    const store = memoryRateLimitStore(3);
    for (const k of ['a', 'b', 'c', 'd']) await store.hit(k, { limit: 1, windowMs: 1000 }, 0);
    // 'a' was evicted, so it is allowed again.
    expect((await store.hit('a', { limit: 1, windowMs: 1000 }, 0)).allowed).toBe(true);
    expect((await store.hit('d', { limit: 1, windowMs: 1000 }, 0)).allowed).toBe(false);
  });

  it('upstash store speaks the REST EVAL protocol', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as string[];
      expect(body[0]).toBe('EVAL');
      expect(body[3]).toBe('rl:k');
      expect(body.slice(4)).toEqual(['5', '60000', '123']);
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
      return new Response(JSON.stringify({ result: [0, 0, 4200] }));
    });
    const store = upstashRateLimitStore({ url: 'https://redis.test', token: 't', fetch: fetchMock as never });
    expect(await store.hit('k', { limit: 5, windowMs: 60_000 }, 123)).toEqual({
      allowed: false,
      limit: 5,
      remaining: 0,
      retryAfterMs: 4200,
    });
  });
});
