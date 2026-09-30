import { DomainError } from '@yayatoh/kernel';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { onV1Error } from '../src/http.ts';
import { clientInfo, decodeCursor, encodeCursor, memoryRateLimiter, pageOf } from '../src/index.ts';
import { Order, toWire } from '../src/resources.ts';

const headers = (h: Record<string, string>) => new Headers(h);

describe('cursors', () => {
  it('round-trip a keyset position and stay opaque', () => {
    const after = { at: new Date('2029-01-02T03:04:05.678Z'), id: '01a0e482-f884-71d3-9c6f-6c25e3bdef0d' };
    const c = encodeCursor(after);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual(after);
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
  });

  it('reject tampered or foreign cursors as validation_failed', () => {
    for (const bad of [
      'garbage',
      encodeCursor({ at: new Date(), id: 'x' } as never),
      Buffer.from('[1,2]').toString('base64url'),
    ]) {
      expect(() => decodeCursor(bad)).toThrowError(expect.objectContaining({ code: 'validation_failed' }));
    }
  });

  it('page from limit + 1 rows: the extra row only signals more', () => {
    const rows = [1, 2, 3].map((n) => ({
      id: `0000000${n}-0000-7000-8000-000000000000`,
      at: new Date(n * 1000),
    }));
    const full = pageOf(rows, 2, (r) => ({ at: r.at, id: r.id }));
    expect(full.data).toHaveLength(2);
    expect(decodeCursor(full.nextCursor ?? '')).toEqual({ at: rows[1]?.at, id: rows[1]?.id });
    expect(pageOf(rows.slice(0, 2), 2, (r) => ({ at: r.at, id: r.id })).nextCursor).toBeNull();
  });
});

describe('rate limiter (token bucket)', () => {
  it('allows the limit, refuses the next with a retry time, and refills over the window', () => {
    let now = 0;
    const rl = memoryRateLimiter({ clock: () => now });
    for (let i = 0; i < 5; i++) expect(rl.take('k', 5, 60).allowed).toBe(true);
    const refused = rl.take('k', 5, 60);
    expect(refused).toMatchObject({ allowed: false, remaining: 0 });
    expect(refused.resetSeconds).toBe(12);
    expect(rl.take('other', 5, 60).allowed).toBe(true);
    now = 12_000;
    expect(rl.take('k', 5, 60).allowed).toBe(true);
  });

  it('keeps memory bounded by evicting the least recently used key', () => {
    const rl = memoryRateLimiter({ maxKeys: 2, clock: () => 0 });
    rl.take('a', 1, 60);
    rl.take('b', 1, 60);
    rl.take('c', 1, 60);
    // `a` was evicted, so it starts with a full bucket again.
    expect(rl.take('a', 1, 60).allowed).toBe(true);
  });
});

describe('client info for app-version telemetry', () => {
  it('reads X-Yayatoh-Client, then X-App-Version with a guessed client, then the user agent', () => {
    expect(clientInfo(headers({ 'x-yayatoh-client': 'iOS/3.2.1' }))).toEqual({
      client: 'ios',
      appVersion: '3.2.1',
    });
    expect(clientInfo(headers({ 'x-app-version': '2.0.0', 'user-agent': 'okhttp/4.12' }))).toEqual({
      client: 'android',
      appVersion: '2.0.0',
    });
    expect(clientInfo(headers({ 'user-agent': 'Yayatoh/1.9.4 CFNetwork/1498 Darwin/23' }))).toEqual({
      client: 'ios',
      appVersion: '1.9.4',
    });
    expect(clientInfo(headers({ 'user-agent': 'YayatohSDK/0.2.0 node' }))).toEqual({
      client: 'sdk-ts',
      appVersion: '0.2.0',
    });
    expect(clientInfo(headers({}))).toEqual({ client: 'other', appVersion: 'unknown' });
    // Junk never reaches the counters.
    expect(clientInfo(headers({ 'x-yayatoh-client': 'ios/<script>' }))).toEqual({
      client: 'ios',
      appVersion: 'unknown',
    });
  });
});

describe('problem+json', () => {
  const app = new Hono()
    .get('/rl', () => {
      throw new DomainError('rate_limited', 'slow down', { retryAfter: 7 });
    })
    .get('/boom', () => {
      throw new Error('secret SQL details');
    })
    .onError(onV1Error);

  it('maps domain errors to their status with a stable code and Retry-After on 429', async () => {
    const r = await app.request('/rl');
    expect(r.status).toBe(429);
    expect(r.headers.get('content-type')).toBe('application/problem+json');
    expect(r.headers.get('retry-after')).toBe('7');
    expect(await r.json()).toMatchObject({ status: 429, code: 'rate_limited', title: 'Too many requests' });
  });

  it('never leaks internals', async () => {
    const r = await app.request('/boom');
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('SQL');
  });
});

describe('wire allowlists', () => {
  it('drop every field the resource does not declare and render dates as ISO strings', () => {
    const o = toWire(Order, {
      id: '01a0e482-f884-71d3-9c6f-6c25e3bdef0d',
      eventId: '01a0e482-f884-71d3-9c6f-6c25e3bdef0e',
      orgId: 'leak',
      status: 'paid',
      buyerName: 'B',
      buyerEmail: 'b@example.test',
      currency: 'USD',
      subtotalMinor: 1,
      discountMinor: 0,
      promoCode: null,
      feeMinor: 0,
      totalMinor: 1,
      paidAt: new Date('2029-01-01T00:00:00Z'),
      createdAt: new Date('2029-01-01T00:00:00Z'),
      providerPaymentId: 'pi_secret',
      items: [],
    });
    expect(o).not.toHaveProperty('orgId');
    expect(o).not.toHaveProperty('providerPaymentId');
    expect(o.paidAt).toBe('2029-01-01T00:00:00.000Z');
  });
});
