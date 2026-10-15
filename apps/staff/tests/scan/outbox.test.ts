import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, backoffMs } from '../../src/scan/backoff';
import { BATCH_SIZE, disagrees } from '../../src/scan/engine';
import { FakeServer, header, NOW, rig, row } from './harness';

const atServerTime = Date.parse('2027-12-01T12:00:00Z');
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

async function ready(server: FakeServer, over: Parameters<typeof rig>[1] = {}) {
  const r = await rig(server, { at: atServerTime, ...over });
  await r.engine.sync();
  r.clock.ms = Date.parse(NOW);
  return r;
}

describe('backoff', () => {
  it('doubles from 2 s up to a 5 minute cap, spread by ±20 %', () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, 0.5))).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffMs(20, 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffMs(1, 0)).toBe(Math.round(BACKOFF_BASE_MS * 0.8));
    expect(backoffMs(1, 1)).toBe(Math.round(BACKOFF_BASE_MS * 1.2));
    expect(backoffMs(0)).toBe(0);
  });
});

describe('what counts as the server disagreeing', () => {
  it('flags a phone admission the server says was a duplicate or invalid, not a confirmation', () => {
    expect(disagrees('admit', 'duplicate_offline')).toBe(true);
    expect(disagrees('admit', 'duplicate')).toBe(true);
    expect(disagrees('admit', 'void')).toBe(true);
    expect(disagrees('granted', 'no_access')).toBe(true);
    expect(disagrees('admit', 'admitted')).toBe(false);
    expect(disagrees('provisional', 'provisional')).toBe(false);
    expect(disagrees('provisional', 'admitted')).toBe(false);
    // A refusal on the phone is never "wrong" because the server also refused (or admitted later).
    expect(disagrees('duplicate', 'duplicate')).toBe(false);
    expect(disagrees('invalid', 'invalid')).toBe(false);
    expect(disagrees('void', 'admitted')).toBe(false);
  });
});

describe('the outbox', () => {
  it('sends batches of at most 500, oldest first, and empties the queue', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(1200) });
    const r = await ready(server);
    for (let i = 1; i <= 1200; i++) {
      r.clock.ms += 1;
      await r.engine.scan(row(i).shortCode);
    }
    expect(r.engine.queueDepth).toBe(1200);
    const result = await r.engine.flush();
    expect(server.batches).toEqual([BATCH_SIZE, BATCH_SIZE, 200]);
    expect(result).toMatchObject({ sent: 1200, remaining: 0, error: null });
    expect(r.engine.queueDepth).toBe(0);
    expect(await r.store.count()).toBe(0);
  }, 60_000);

  it('keeps the queue when the network is down and sends it when it returns', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(3) });
    const r = await ready(server);
    await r.engine.scan(row(1).shortCode);
    await r.engine.scan(row(2).shortCode);
    server.online = false;
    expect(await r.engine.flush()).toMatchObject({ sent: 0, remaining: 2, error: 'offline' });
    expect(r.engine.queueDepth).toBe(2);
    server.online = true;
    expect(await r.engine.flush({ force: true })).toMatchObject({ sent: 2, remaining: 0, error: null });
  });

  it('survives a restart with the queue intact', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(3) });
    const r = await ready(server);
    await r.engine.scan(row(1).shortCode);
    const again = await rig(server, { db: r.db, at: Date.parse(NOW) });
    expect(again.engine.queueDepth).toBe(1);
    await again.engine.flush();
    expect(server.seen.size).toBe(1);
  });

  it('retries with growing delays and resets after a success', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    await r.engine.scan(row(1).shortCode);
    server.online = false;
    const start = r.clock.ms;
    await r.engine.flush();
    const first = r.engine.nextAttemptAt - start;
    expect(first).toBeGreaterThanOrEqual(1600);
    expect(first).toBeLessThanOrEqual(2400);
    // Before the delay has passed, an automatic flush does not even try.
    const before = server.batches.length;
    expect(await r.engine.flush()).toMatchObject({ skipped: true });
    r.clock.ms = r.engine.nextAttemptAt;
    await r.engine.flush();
    const second = r.engine.nextAttemptAt - r.clock.ms;
    expect(second).toBeGreaterThanOrEqual(3200);
    expect(second).toBeLessThanOrEqual(4800);
    server.online = true;
    r.clock.ms = r.engine.nextAttemptAt;
    expect(await r.engine.flush()).toMatchObject({ sent: 1, error: null });
    expect(r.engine.nextAttemptAt).toBe(0);
    expect(server.batches.length).toBe(before + 1);
  });

  it('shares one run between callers asking at once', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    await r.engine.scan(row(1).shortCode);
    await Promise.all([r.engine.flush(), r.engine.flush(), r.engine.flush()]);
    expect(server.batches).toEqual([1]);
  });

  it('is safe to send again after a cut-off: the server applies each scan id once', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    await r.engine.scan(row(1).shortCode);
    const [queued] = await r.store.peek(5);
    // The server took the batch, but the phone never heard back.
    await server.api().syncScans('x', [queued as never]);
    expect(await r.engine.flush()).toMatchObject({ sent: 1, remaining: 0 });
    expect(server.admissions.size).toBe(1);
  });

  it('stops and flags the device when the token is refused, keeping the queue', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    await r.engine.scan(row(1).shortCode);
    server.tokenValid = false;
    expect(await r.engine.flush()).toMatchObject({ error: 'unauthorized', remaining: 1 });
    expect(r.engine.status.unauthorized).toBe(true);
    expect(await r.engine.flush()).toMatchObject({ error: 'unauthorized' });
    expect(r.engine.queueDepth).toBe(1);
  });

  it('halves a batch the server refuses until the bad scan stands alone, and flags it', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(5) });
    const r = await ready(server);
    for (let i = 1; i <= 5; i++) {
      r.clock.ms += 1;
      await r.engine.scan(row(i).shortCode);
    }
    const queued = await r.store.peek(10);
    server.poison.add(queued[2]?.scanId as string);
    const result = await r.engine.flush();
    expect(result.sent).toBe(4);
    expect(result.flagged.map((f) => [f.ticketId, f.serverResult])).toEqual([
      [queued[2]?.ticketId, 'rejected'],
    ]);
    expect(r.engine.queueDepth).toBe(0);
    expect(r.engine.status.flaggedCount).toBe(1);
  });
});

describe('flags', () => {
  it('keeps flags across a restart and lets staff dismiss them', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const a = await ready(server);
    const b = await ready(server);
    // Phone B scanned first, but A syncs first: A is accepted, then B's earlier scan flips A's.
    b.clock.ms -= 60_000;
    await b.engine.scan(row(1).shortCode);
    await a.engine.scan(row(1).shortCode);
    await a.engine.flush();
    const flip = await b.engine.flush();
    expect(flip.flagged).toEqual([]);
    expect(server.flipped).toHaveLength(1);

    // The other order: the later scan syncs second and is the one flagged.
    const c = await ready(server);
    await c.engine.scan(row(2).shortCode);
    await c.engine.flush();
    const d = await ready(server);
    d.clock.ms += 30_000;
    await d.engine.scan(row(2).shortCode);
    const result = await d.engine.flush();
    expect(result.flagged).toHaveLength(1);
    expect(d.engine.status.flaggedCount).toBe(1);
    const restarted = await rig(server, { db: d.db, at: d.clock.ms });
    expect(restarted.engine.status.flaggedCount).toBe(1);
    const [flag] = await restarted.engine.flags();
    expect(flag).toMatchObject({
      localVerdict: 'admit',
      serverResult: 'duplicate_offline',
      holderName: 'Holder 2',
    });
    await restarted.engine.dismissFlag(flag?.scanId as string);
    expect(restarted.engine.status.flaggedCount).toBe(0);
  });
});
