import { EXPIRY_MS, ScanUnavailableError } from '../../src/scan/engine';
import { ScanAuthError, ScanSyncError } from '../../src/scan/api';
import {
  FakeServer,
  NORTH,
  NOW,
  SOUTH,
  SYNC_MS,
  header,
  rig,
  row,
  signedCode,
  signedLate,
  ticketId,
} from './harness';

const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));
const atServerTime = Date.parse('2027-12-01T12:00:00Z');

/** A rig that has downloaded the manifest and then moved to scanning time. */
async function ready(server: FakeServer, over: Parameters<typeof rig>[1] = {}) {
  const r = await rig(server, { at: atServerTime, ...over });
  await r.engine.sync();
  r.clock.ms = Date.parse(NOW);
  return r;
}

describe('manifest download', () => {
  it('pages through the manifest into SQLite and reads it back after a restart', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(7), pageSize: 3 });
    const r = await rig(server, { at: atServerTime });
    expect(r.engine.status.phase).toBe('empty');
    await r.engine.sync();
    expect(server.manifestCalls.map((c) => [c.cursor, c.overlap])).toEqual([
      [null, false],
      ['3', false],
      ['6', false],
    ]);
    expect(r.engine.status).toMatchObject({ phase: 'ready', ticketCount: 7, eventName: 'Harness Summit' });
    expect(r.engine.status.lastSyncAt).toBe(new Date(SYNC_MS).toISOString());
    // A fresh engine on the same database: no network needed to be ready.
    server.online = false;
    const again = await rig(server, { db: r.db, at: Date.parse(NOW) });
    expect(again.engine.status).toMatchObject({ phase: 'ready', ticketCount: 7 });
    expect((await again.engine.scan(row(5).shortCode)).verdict).toBe('admit');
  });

  it('refreshes by cursor with an overlap on the first page', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(4) });
    const r = await ready(server);
    server.rows.push(row(5, { holderName: 'Late Buyer' }));
    r.clock.ms = atServerTime;
    await r.engine.sync();
    expect(server.manifestCalls.at(-1)).toMatchObject({ cursor: '4', overlap: true });
    expect(r.engine.status.ticketCount).toBe(5);
  });

  it('forgets a short code when the ticket is reissued with a new one', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    server.rows.push(row(1, { shortCode: 'NEWCODE1', rev: 1 }));
    r.clock.ms = atServerTime;
    await r.engine.sync();
    r.clock.ms = Date.parse(NOW);
    expect((await r.engine.scan(row(1).shortCode)).verdict).toBe('invalid');
    expect((await r.engine.scan('NEWCODE1')).verdict).toBe('admit');
  });

  it('refuses a manifest whose scope signature does not verify, and keeps nothing of it', async () => {
    const good = await header();
    const bad = { ...good, scope: { ...good.scope!, checkpointIds: [NORTH] } };
    const server = new FakeServer({ header: bad, rows: rows(3) });
    const r = await rig(server, { at: atServerTime });
    await expect(r.engine.sync()).rejects.toThrow(ScanSyncError);
    expect(r.engine.status).toMatchObject({ phase: 'empty', ticketCount: 0, syncError: 'bad_scope' });
    expect(await r.store.loadRows()).toEqual([]);
  });

  it('reports offline and a refused device token without losing the list it has', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(3) });
    const r = await ready(server);
    server.online = false;
    await expect(r.engine.sync()).rejects.toThrow();
    expect(r.engine.status).toMatchObject({ phase: 'ready', syncError: 'offline', ticketCount: 3 });
    server.online = true;
    server.tokenValid = false;
    await expect(r.engine.sync()).rejects.toThrow(ScanAuthError);
    expect(r.engine.status.unauthorized).toBe(true);
    // Scanning still works from the saved list.
    expect((await r.engine.scan(row(2).shortCode)).verdict).toBe('admit');
  });

  it('shares one download between callers', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await rig(server, { at: atServerTime });
    await Promise.all([r.engine.sync(), r.engine.sync()]);
    expect(server.manifestCalls).toHaveLength(1);
  });

  it('measures the clock offset against the server time and applies it to scans', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    // The phone's clock runs 2 minutes behind the server's.
    const r = await rig(server, { at: atServerTime - 120_000 });
    await r.engine.sync();
    r.clock.ms = Date.parse(NOW) - 120_000;
    await r.engine.scan(row(1).shortCode);
    const [queued] = await r.store.peek(10);
    expect(queued?.clockOffsetMs).toBe(120_000);
  });

  it('refetches a list from an older manifest format from scratch', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(3) });
    const r = await rig(server, { at: atServerTime });
    await r.store.setMeta('header', JSON.stringify({ ...(await header()), version: 1, scope: undefined }));
    await r.store.setMeta('cursor', '3');
    await r.store.upsertRows([row(99)]);
    await r.engine.load();
    await r.engine.sync();
    expect(server.manifestCalls[0]).toMatchObject({ cursor: null });
    expect(r.engine.status.ticketCount).toBe(3);
  });
});

describe('scanning', () => {
  it('refuses to scan before a list is downloaded', async () => {
    const r = await rig(new FakeServer({ header: await header(), rows: rows(1) }));
    await expect(r.engine.scan('ABC')).rejects.toThrow(ScanUnavailableError);
  });

  it('admits, then says where and when the repeat was first admitted', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(3) });
    const r = await ready(server);
    r.engine.setCheckpoint(NORTH);
    const first = await r.engine.scan(row(1).shortCode);
    expect(first).toMatchObject({ verdict: 'admit', holderName: 'Holder 1', typeName: 'General', firstAdmission: null });
    r.clock.ms += 90_000;
    r.engine.setCheckpoint(SOUTH);
    const again = await r.engine.scan(` ${row(1).shortCode.toLowerCase()} `);
    expect(again.verdict).toBe('duplicate');
    expect(again.firstAdmission).toEqual({ at: new Date(Date.parse(NOW)).toISOString(), checkpointName: 'North gate' });
  });

  it('remembers admissions across a restart', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(3) });
    const r = await ready(server);
    await r.engine.scan(row(2).shortCode);
    const again = await rig(server, { db: r.db, at: Date.parse(NOW) });
    expect((await again.engine.scan(row(2).shortCode)).verdict).toBe('duplicate');
    // Every scan is queued, the repeat included.
    expect(again.engine.queueDepth).toBe(2);
  });

  it('verifies signed codes, including a superseded revision and an unknown ticket', async () => {
    const server = new FakeServer({ header: await header(), rows: [row(1, { rev: 2 }), row(2, { status: 'void' })] });
    const r = await ready(server);
    expect((await r.engine.scan(await signedCode(1, 1))).verdict).toBe('superseded');
    expect((await r.engine.scan(await signedCode(1, 2))).verdict).toBe('admit');
    expect((await r.engine.scan(await signedCode(2))).verdict).toBe('void');
    expect((await r.engine.scan('YY1-NOT-A-REAL-CODE')).verdict).toBe('invalid');
    // Signed by the org, issued after the last sync, not in the list: admitted and flagged.
    expect((await r.engine.scan(await signedLate())).verdict).toBe('provisional');
  });

  it('queues every scan once, in order, with the checkpoint', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(3) });
    const r = await ready(server);
    r.engine.setCheckpoint(SOUTH);
    await r.engine.scan(row(1).shortCode);
    r.clock.ms += 1000;
    await r.engine.scan(row(2).shortCode);
    expect(r.engine.queueDepth).toBe(2);
    const queued = await r.store.peek(10);
    expect(queued.map((q) => [q.ticketId, q.verdict, q.checkpointId])).toEqual([
      [ticketId(1), 'admit', SOUTH],
      [ticketId(2), 'admit', SOUTH],
    ]);
    expect(new Set(queued.map((q) => q.scanId)).size).toBe(2);
  });

  it('judges a code too long for the wire but never queues it', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(1) });
    const r = await ready(server);
    expect((await r.engine.scan('X'.repeat(401))).verdict).toBe('invalid');
    expect((await r.engine.scan('   ')).verdict).toBe('invalid');
    expect(r.engine.queueDepth).toBe(0);
  });

  it('treats a checkpoint the list no longer has as the whole event', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(1) });
    const r = await ready(server);
    r.engine.setCheckpoint('archived-gate');
    expect(r.engine.checkpoint).toBeNull();
    expect((await r.engine.scan(row(1).shortCode)).verdict).toBe('admit');
    expect((await r.store.peek(1))[0]?.checkpointId).toBeUndefined();
  });

  it('does not lose or double count scans that arrive together', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    const outcomes = await Promise.all([r.engine.scan(row(1).shortCode), r.engine.scan(row(1).shortCode)]);
    expect(outcomes.map((o) => o.verdict)).toEqual(['admit', 'duplicate']);
  });

  it('notifies subscribers as the queue changes', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    const depths: number[] = [];
    r.engine.subscribe(() => depths.push(r.engine.status.queueDepth));
    await r.engine.scan(row(1).shortCode);
    await r.engine.flush();
    expect(depths).toContain(1);
    expect(depths.at(-1)).toBe(0);
  });
});

describe('expiry and wipe', () => {
  it('keeps the list until 24 h after the event ends, then clears it', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const onExpired = jest.fn();
    const r = await ready(server, { onExpired });
    const end = Date.parse('2027-12-03T04:00:00Z');
    r.clock.ms = end + EXPIRY_MS;
    expect(await r.engine.expireIfDue()).toBe(false);
    r.clock.ms = end + EXPIRY_MS + 1;
    expect(await r.engine.expireIfDue()).toBe(true);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(r.engine.status).toMatchObject({ phase: 'expired', ticketCount: 0, queueDepth: 0 });
    expect(await r.store.loadRows()).toEqual([]);
    await expect(r.engine.scan(row(1).shortCode)).rejects.toThrow(ScanUnavailableError);
  });

  it('sends what it can before clearing an expired list', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    await r.engine.scan(row(1).shortCode);
    r.clock.ms = Date.parse('2027-12-03T04:00:00Z') + EXPIRY_MS + 1;
    await r.engine.expireIfDue();
    expect(server.seen.size).toBe(1);
  });

  it('clears an expired list when the app starts', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    const onExpired = jest.fn();
    const later = await rig(server, {
      db: r.db,
      at: Date.parse('2027-12-04T04:00:01Z'),
      onExpired,
    });
    expect(later.engine.status.phase).toBe('expired');
    expect(onExpired).toHaveBeenCalled();
    expect(await later.store.loadRows()).toEqual([]);
  });

  it('clearAll leaves nothing in any table', async () => {
    const server = new FakeServer({ header: await header(), rows: rows(2) });
    const r = await ready(server);
    await r.engine.scan(row(1).shortCode);
    await r.engine.clearAll();
    for (const table of ['manifest_rows', 'admissions', 'in_room', 'door_log', 'outbox', 'flags', 'meta']) {
      expect(await r.db.all(`SELECT * FROM ${table}`)).toEqual([]);
    }
    expect(r.engine.status).toMatchObject({ phase: 'empty', ticketCount: 0, queueDepth: 0 });
  });
});
