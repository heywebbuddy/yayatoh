/**
 * Offline drill (X): two phones with no connection admit the same ticket, reconnect, and the
 * duplicate is flagged within 60 seconds. Each phone has its own database and outbox; they share
 * one server with the real first-wins rule. Time is simulated.
 */
import { createScheduler } from '../../src/scan/scheduler';
import { FakeServer, header, NORTH, NOW, rig, row, SOUTH } from './harness';

const atServerTime = Date.parse('2027-12-01T12:00:00Z');

async function phone(server: FakeServer, checkpoint: string) {
  const r = await rig(server, { at: atServerTime });
  await r.engine.sync();
  r.engine.setCheckpoint(checkpoint);
  r.clock.ms = Date.parse(NOW);
  return r;
}

describe('offline drill: two phones admit the same ticket', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('flags the duplicate within 60 s of the second phone reconnecting', async () => {
    const server = new FakeServer({ header: await header(), rows: [row(1), row(2)] });
    const north = await phone(server, NORTH);
    const south = await phone(server, SOUTH);
    // Both lose their connection (the venue Wi-Fi drops).
    server.online = false;
    const a = createScheduler({ engine: north.engine, now: () => north.clock.ms, online: false });
    const b = createScheduler({ engine: south.engine, now: () => south.clock.ms, online: false });
    a.start();
    b.start();
    expect((await north.engine.scan(row(1).shortCode)).verdict).toBe('admit');
    north.clock.ms += 20_000;
    south.clock.ms += 20_000;
    // The same ticket at the other door, 20 s later: neither phone can know.
    expect((await south.engine.scan(row(1).shortCode)).verdict).toBe('admit');
    a.kick();
    b.kick();
    expect(server.seen.size).toBe(0);

    // The network returns. North reconnects first, South a few seconds later.
    const reconnectedAt = north.clock.ms;
    server.online = true;
    a.setOnline(true);
    await jest.advanceTimersByTimeAsync(0);
    await north.engine.flush();
    south.clock.ms += 5_000;
    b.setOnline(true);
    await jest.advanceTimersByTimeAsync(0);
    await south.engine.flush();

    expect(south.clock.ms - reconnectedAt).toBeLessThanOrEqual(60_000);
    expect(north.engine.status.flaggedCount).toBe(0);
    expect(south.engine.status).toMatchObject({ flaggedCount: 1, queueDepth: 0 });
    const [flag] = await south.engine.flags();
    expect(flag).toMatchObject({
      ticketId: row(1).ticketId,
      holderName: 'Holder 1',
      localVerdict: 'admit',
      serverResult: 'duplicate_offline',
    });
    expect(server.admissions.size).toBe(1);
    a.stop();
    b.stop();
  });

  it('the tick retries on its own, so a phone that reconnects quietly still syncs within a minute', async () => {
    const server = new FakeServer({ header: await header(), rows: [row(1)] });
    const p = await phone(server, NORTH);
    let t = p.clock.ms;
    const s = createScheduler({ engine: p.engine, now: () => t, online: true });
    server.online = false;
    s.start();
    await jest.advanceTimersByTimeAsync(0);
    await p.engine.scan(row(1).shortCode);
    server.online = true; // the OS never tells us; the loop must find out
    for (let i = 0; i < 6; i++) {
      t += 10_000;
      await jest.advanceTimersByTimeAsync(10_000);
    }
    expect(p.engine.queueDepth).toBe(0);
    s.stop();
  });

  it('refreshes the manifest on the interval and does nothing offline', async () => {
    const server = new FakeServer({ header: await header(), rows: [row(1)] });
    const p = await phone(server, NORTH);
    let t = p.clock.ms;
    const s = createScheduler({ engine: p.engine, now: () => t, online: true });
    s.start();
    await jest.advanceTimersByTimeAsync(0);
    const initial = server.manifestCalls.length;
    t += 5 * 60_000;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(server.manifestCalls.length).toBeGreaterThan(initial);
    s.setOnline(false);
    const during = server.manifestCalls.length;
    t += 10 * 60_000;
    await jest.advanceTimersByTimeAsync(30_000);
    expect(server.manifestCalls.length).toBe(during);
    s.stop();
  });

  it('clears an expired list from the tick', async () => {
    const server = new FakeServer({ header: await header(), rows: [row(1)] });
    const onExpired = jest.fn();
    const p = await rig(server, { at: atServerTime, onExpired });
    await p.engine.sync();
    const t = Date.parse('2027-12-03T04:00:00Z') + 24 * 3_600_000 + 1;
    p.clock.ms = t;
    const s = createScheduler({ engine: p.engine, now: () => t, online: false });
    s.start();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(onExpired).toHaveBeenCalled();
    expect(p.engine.status.phase).toBe('expired');
    s.stop();
  });
});
