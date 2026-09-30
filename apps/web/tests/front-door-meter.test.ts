import { describe, expect, it } from 'vitest';
import { FrontDoorMeter } from '../src/lib/front-door/meter.ts';

describe('front-door meter (M2.4a watch)', () => {
  it('aggregates per host × route × server and flushes once per interval', async () => {
    let now = 0;
    const writes: unknown[][] = [];
    const m = new FrontDoorMeter(
      async (s, p) => {
        writes.push([s, p]);
      },
      1000,
      () => now,
    );
    m.record({ host: 'yayatoh.com', route: 'legacy', servedBy: 'legacy', status: 200, latencyMs: 12.4 });
    m.record({
      host: 'yayatoh.com',
      route: 'legacy',
      servedBy: 'legacy',
      status: 404,
      latencyMs: 30,
      path: '/gone?x=1',
    });
    m.record({
      host: 'yayatoh.com',
      route: 'legacy',
      servedBy: 'legacy',
      status: 504,
      proxyError: true,
      latencyMs: 3000,
    });
    m.record({ host: 'yayatoh.com', route: 'legacy', servedBy: 'legacy', status: 500, latencyMs: 5 });
    m.record({ host: 'yayatoh.com', route: 'events.page', servedBy: 'next' });
    m.notFound('yayatoh.com', 'events.page', '/events/missing');
    expect(m.maybeFlush()).toBeNull();
    now = 1000;
    await m.maybeFlush();
    expect(writes).toHaveLength(1);
    const [stats, paths] = writes[0] as [Record<string, unknown>[], Record<string, unknown>[]];
    expect(stats).toEqual([
      {
        host: 'yayatoh.com',
        route: 'legacy',
        servedBy: 'legacy',
        requests: 4,
        notFound: 1,
        proxyErrors: 1,
        upstream5xx: 1,
        latencyCount: 4,
        latencyMsSum: 12 + 30 + 3000 + 5,
        latencyMsMax: 3000,
      },
      expect.objectContaining({
        route: 'events.page',
        servedBy: 'next',
        requests: 1,
        notFound: 1,
        latencyCount: 0,
      }),
    ]);
    expect(paths).toEqual([
      { host: 'yayatoh.com', path: '/gone', servedBy: 'legacy', count: 1 },
      { host: 'yayatoh.com', path: '/events/missing', servedBy: 'next', count: 1 },
    ]);
    // Nothing new: no write.
    now = 5000;
    await m.maybeFlush();
    expect(writes).toHaveLength(1);
  });

  it('a failed write loses only that batch', async () => {
    let fail = true;
    const seen: number[] = [];
    const m = new FrontDoorMeter(async (s) => {
      if (fail) throw new Error('db down');
      seen.push(s.length);
    }, 0);
    const original = console.error;
    console.error = () => {};
    try {
      m.record({ host: 'h', route: 'r', servedBy: 'next' });
      await m.flush();
      fail = false;
      m.record({ host: 'h', route: 'r', servedBy: 'next' });
      await m.flush();
    } finally {
      console.error = original;
    }
    expect(seen).toEqual([1]);
  });
});
