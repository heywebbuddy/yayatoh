import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import { DB_KEY_NAME, DB_NAME, openEncryptedScanDb } from '../../src/scan/db';
import { currentScanRuntime, openScanRuntime, registerScanWipe, wipeScanData } from '../../src/scan/runtime';
import { EVENT_ID, FakeServer, fakeSqlite, header, NOW, row, testRandom } from './harness';

const KEY = 'cd'.repeat(32);
const atServerTime = Date.parse('2027-12-01T12:00:00Z');

async function setup() {
  const sqlite = fakeSqlite();
  const storage = memoryKeyValueStore({ [DB_KEY_NAME]: KEY });
  const server = new FakeServer({ header: await header(), rows: [row(1), row(2)] });
  let now = atServerTime;
  const open = (eventId = EVENT_ID) =>
    openScanRuntime({
      eventId,
      api: server.api(),
      random: testRandom,
      storage,
      sqlite: sqlite.module,
      openDb: () => openEncryptedScanDb(sqlite.module, KEY),
      now: () => now,
    });
  return { sqlite, storage, server, open, setNow: (ms: number) => void (now = ms) };
}

afterEach(async () => {
  await currentScanRuntime()?.close();
});

describe('the scan runtime', () => {
  it('opens one engine per event and reuses it', async () => {
    const { open } = await setup();
    const a = await open();
    expect(await open()).toBe(a);
    expect(currentScanRuntime()).toBe(a);
  });

  it('keeps the list on disk between launches', async () => {
    const { open, setNow } = await setup();
    const a = await open();
    await a.engine.sync();
    await a.close();
    setNow(Date.parse(NOW));
    const b = await open();
    expect(b).not.toBe(a);
    expect(b.engine.status).toMatchObject({ phase: 'ready', ticketCount: 2 });
  });

  it('empties a database that holds another event’s data', async () => {
    const { open } = await setup();
    const a = await open();
    await a.engine.sync();
    const b = await open('0192d3a0-0000-7000-8000-0000000000e2');
    expect(b.engine.status).toMatchObject({ phase: 'empty', ticketCount: 0, queueDepth: 0 });
    expect(a.scheduler).not.toBe(b.scheduler);
  });

  it('stops, empties and deletes everything on a wipe, key included', async () => {
    const { open, sqlite, storage } = await setup();
    const a = await open();
    await a.engine.sync();
    expect(sqlite.exists(DB_NAME)).toBe(true);
    await wipeScanData({ storage, sqlite: sqlite.module });
    expect(currentScanRuntime()).toBeNull();
    expect(sqlite.exists(DB_NAME)).toBe(false);
    expect(storage.data.has(DB_KEY_NAME)).toBe(false);
    expect(a.engine.status).toMatchObject({ phase: 'empty', ticketCount: 0 });
  });

  it('wipes a device whose scan screen was never opened this launch', async () => {
    const { open, sqlite, storage } = await setup();
    const a = await open();
    await a.engine.sync();
    await a.close();
    // A cold start: nothing is open, only the file and the key exist.
    await wipeScanData({ storage, sqlite: sqlite.module });
    expect(sqlite.exists(DB_NAME)).toBe(false);
    expect(storage.data.has(DB_KEY_NAME)).toBe(false);
  });

  it('wipes when the device layer says so, and stops when unregistered', async () => {
    const { open, sqlite, storage } = await setup();
    let wipe: (() => void | Promise<void>) | undefined;
    const unregister = registerScanWipe(
      (cb) => {
        wipe = cb;
        return () => {
          wipe = undefined;
        };
      },
      { storage, sqlite: sqlite.module },
    );
    const a = await open();
    await a.engine.sync();
    await wipe?.();
    expect(sqlite.exists(DB_NAME)).toBe(false);
    unregister();
    expect(wipe).toBeUndefined();
  });

  it('accepts an onWipe that returns nothing', () => {
    const sqlite = fakeSqlite();
    const off = registerScanWipe(() => {}, { storage: memoryKeyValueStore(), sqlite: sqlite.module });
    expect(off).toEqual(expect.any(Function));
  });

  it('deletes the file and the key when the list expires', async () => {
    const { open, sqlite, storage, setNow } = await setup();
    const a = await open();
    await a.engine.sync();
    setNow(Date.parse('2027-12-03T04:00:00Z') + 24 * 3_600_000 + 1);
    expect(await a.engine.expireIfDue()).toBe(true);
    expect(sqlite.exists(DB_NAME)).toBe(false);
    expect(storage.data.has(DB_KEY_NAME)).toBe(false);
    expect(currentScanRuntime()).toBeNull();
  });
});
