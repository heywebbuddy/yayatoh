/**
 * Test harness for the scanner (M7.4b): Node's SQLite behind the same port the phone's SQLCipher
 * database uses, a fake server with the real server's first-wins rule, and signed event fixtures.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  eventDay,
  MANIFEST_VERSION,
  type ManifestHeader,
  type ManifestRow,
  SCOPE_TAG,
  scopeMessage,
} from '@yayatoh/checkin-engine';
import {
  ed25519KeyPairFromSeed,
  signStatement,
  signTicketCode,
  verifyTicketCode,
} from '@yayatoh/ticket-crypto';
import { type ManifestRequest, type ScanApi, ScanAuthError, ScanRejectedError } from '../../src/scan/api';
import { type ScanDb, type SqliteHandle, type SqliteModule, wrapHandle } from '../../src/scan/db';
import { type EngineDeps, ScanEngine } from '../../src/scan/engine';
import { ScanStore } from '../../src/scan/store';
import type { ManifestPage, QueuedScan, SyncResponse } from '../../src/scan/types';

export function nodeHandle(path = ':memory:'): SqliteHandle {
  const db = new DatabaseSync(path);
  return {
    execAsync: async (sql) => void db.exec(sql),
    runAsync: async (sql, params) => db.prepare(sql).run(...params),
    getAllAsync: async <T>(sql: string, params: unknown[]) =>
      db.prepare(sql).all(...(params as never[])) as unknown as T[],
    closeAsync: async () => db.close(),
  };
}

export const memoryDb = (): ScanDb => wrapHandle(nodeHandle());

/** A stand-in for `expo-sqlite` over Node's SQLite, with real files so a reopen sees the same data. */
export function fakeSqlite() {
  const dir = mkdtempSync(join(tmpdir(), 'yy-scan-'));
  const opened: string[] = [];
  const deleted: string[] = [];
  const statements: string[] = [];
  const module: SqliteModule = {
    async openDatabaseAsync(name) {
      opened.push(name);
      const handle = nodeHandle(join(dir, name));
      return {
        ...handle,
        execAsync: async (sql) => {
          statements.push(sql);
          return handle.execAsync(sql);
        },
      };
    },
    async deleteDatabaseAsync(name) {
      deleted.push(name);
      for (const suffix of ['', '-wal', '-shm']) rmSync(join(dir, name + suffix), { force: true });
    },
  };
  return { module, opened, deleted, statements, exists: (name: string) => existsSync(join(dir, name)) };
}

// --- the event -------------------------------------------------------------------------------

const sha = (s: string) => createHash('sha256').update(s).digest();
const seed = (label: string) => new Uint8Array(sha(`yayatoh-test-vector-key:${label}`));
export const ORG = (() => {
  const pair = ed25519KeyPairFromSeed(seed('org-a'));
  return { ...pair, b64: Buffer.from(pair.publicKey).toString('base64') };
})();

export const SYNC_MS = Date.parse('2027-12-01T12:00:00Z');
export const NOW = '2027-12-01T20:00:00Z';
export const EVENT_ID = '0192d3a0-0000-7000-8000-0000000000e1';
export const NORTH = '0192d3a0-0000-7000-8000-00000000c001';
export const SOUTH = '0192d3a0-0000-7000-8000-00000000c002';
const EVENT = {
  id: EVENT_ID,
  name: 'Harness Summit',
  startsAt: '2027-12-01T15:00:00Z',
  endsAt: '2027-12-03T04:00:00Z',
  timezone: 'America/Chicago',
};

export const ticketId = (n: number) =>
  `${(SYNC_MS - 86_400_000)
    .toString(16)
    .padStart(12, '0')
    .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-${n.toString(16).padStart(12, '0')}`;

export async function header(over: Partial<ManifestHeader> = {}): Promise<ManifestHeader> {
  const base = { eventId: EVENT_ID, deviceId: 'device-1', checkpointIds: null };
  return {
    event: EVENT,
    publicKeys: { '1': ORG.b64 },
    salt: `yy-manifest:${EVENT_ID}`,
    serverTime: new Date(SYNC_MS).toISOString(),
    unknownPolicy: 'provisional',
    checkpoints: [
      { id: NORTH, name: 'North gate', kind: 'entrance', ticketTypeIds: [] },
      { id: SOUTH, name: 'South gate', kind: 'entrance', ticketTypeIds: [] },
    ],
    version: MANIFEST_VERSION,
    scope: { ...base, signature: await signStatement(SCOPE_TAG, scopeMessage(base), 1, ORG.privateKey) },
    ...over,
  };
}

export function row(n: number, over: Partial<ManifestRow> = {}): ManifestRow {
  return {
    ticketId: ticketId(n),
    shortCode: `T${n.toString(36).toUpperCase().padStart(7, '0')}`,
    rev: 0,
    status: 'active',
    ticketTypeId: 'type-ga',
    typeName: 'General',
    accessDates: [],
    holderName: `Holder ${n}`,
    emailHash: '',
    issuedAt: new Date(SYNC_MS - 86_400_000).toISOString(),
    ...over,
  };
}

export const signedCode = (n: number, rev = 0) =>
  signTicketCode({ kid: 1, ticketId: ticketId(n), rev }, ORG.privateKey);

/** A ticket id issued `afterMs` after the last manifest sync (so it is not in the manifest). */
export const lateTicketId = (afterMs = 60_000) =>
  `${(SYNC_MS + afterMs)
    .toString(16)
    .padStart(12, '0')
    .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-0000000000ff`;
export const signedLate = (afterMs?: number) =>
  signTicketCode({ kid: 1, ticketId: lateTicketId(afterMs), rev: 0 }, ORG.privateKey);

// --- the fake server -------------------------------------------------------------------------

export interface FakeServerOptions {
  readonly header: ManifestHeader;
  readonly rows: readonly ManifestRow[];
  readonly pageSize?: number;
}

/**
 * The real server's rules in miniature: scans are applied once by `scanId`, ordered by corrected
 * device time, and the first admission of a ticket for a day wins; later ones are
 * `duplicate_offline`. Shared by several devices so a race between phones can be played out.
 */
export class FakeServer {
  readonly seen = new Map<string, string>();
  readonly admissions = new Map<string, { at: number; scanId: string }>();
  /** Scans whose stored result was changed to a duplicate after they synced. */
  readonly flipped: string[] = [];
  readonly batches: number[] = [];
  readonly manifestCalls: ManifestRequest[] = [];
  online = true;
  tokenValid = true;
  /** Scan ids the server rejects as malformed (a 422), to exercise bisecting. */
  readonly poison = new Set<string>();
  rows: ManifestRow[];
  header: ManifestHeader;
  private readonly keys = new Map([[1, ORG.publicKey]]);

  constructor(private readonly options: FakeServerOptions) {
    this.rows = [...options.rows];
    this.header = options.header;
  }

  api(): ScanApi {
    return {
      manifestPage: async (_eventId, request) => this.manifest(request),
      syncScans: async (_eventId, scans) => this.sync(scans),
    };
  }

  private gate() {
    if (!this.online) throw new TypeError('Network request failed');
    if (!this.tokenValid) throw new ScanAuthError(401);
  }

  private manifest(request: ManifestRequest): ManifestPage {
    this.gate();
    this.manifestCalls.push(request);
    const start = request.cursor ? Number(request.cursor) : 0;
    const page = this.rows.slice(start, start + Math.min(request.limit, this.options.pageSize ?? 2000));
    const end = start + page.length;
    return { header: this.header, rows: page, cursor: String(end), complete: end >= this.rows.length };
  }

  private async sync(scans: readonly QueuedScan[]): Promise<SyncResponse> {
    this.gate();
    this.batches.push(scans.length);
    if (scans.some((s) => this.poison.has(s.scanId))) throw new ScanRejectedError(422);
    const corrected = (s: QueuedScan) => Date.parse(s.deviceTs) + s.clockOffsetMs;
    const ordered = [...scans].sort((a, b) => corrected(a) - corrected(b));
    const results: SyncResponse['results'][number][] = [];
    let duplicatesOffline = 0;
    for (const s of ordered) {
      const prior = this.seen.get(s.scanId);
      if (prior) {
        results.push({ scanId: s.scanId, result: prior, stored: false });
        continue;
      }
      let result: string = s.verdict;
      if (s.verdict === 'admit' || s.verdict === 'provisional') {
        const id = await this.ticketOf(s.code);
        const day = eventDay(new Date(corrected(s)), this.header.event.timezone);
        const key = `${id}:${day}`;
        const live = this.admissions.get(key);
        const win = s.verdict === 'admit' ? 'admitted' : 'provisional';
        if (!live) {
          this.admissions.set(key, { at: corrected(s), scanId: s.scanId });
          result = win;
        } else if (corrected(s) < live.at) {
          // This scan was earlier: it wins, and the previous winner's scan becomes a duplicate.
          this.seen.set(live.scanId, 'duplicate_offline');
          this.flipped.push(live.scanId);
          this.admissions.set(key, { at: corrected(s), scanId: s.scanId });
          duplicatesOffline += 1;
          result = win;
        } else {
          result = 'duplicate_offline';
          duplicatesOffline += 1;
        }
      }
      this.seen.set(s.scanId, result);
      results.push({ scanId: s.scanId, result, stored: true });
    }
    return { results, duplicatesOffline };
  }

  private async ticketOf(code: string): Promise<string> {
    const v = await verifyTicketCode(code.toUpperCase(), this.keys);
    if (v.ok) return v.ticketId;
    return this.rows.find((r) => r.shortCode === code.toUpperCase())?.ticketId ?? code;
  }
}

// --- an engine on a fresh database -----------------------------------------------------------

export interface Rig {
  readonly engine: ScanEngine;
  readonly store: ScanStore;
  readonly db: ScanDb;
  readonly clock: { ms: number; perf: number };
}

let counter = 0;
/** Deterministic "random" bytes for ids and keys. */
export const testRandom = (length: number) =>
  Uint8Array.from({ length }, (_, i) => (counter++ * 31 + i * 7 + 13) % 256);

export async function rig(
  server: FakeServer,
  over: Partial<EngineDeps> & { at?: number; db?: ScanDb } = {},
): Promise<Rig> {
  const db = over.db ?? memoryDb();
  const store = new ScanStore(db);
  await store.init();
  const clock = { ms: over.at ?? Date.parse(NOW), perf: 0 };
  const engine = new ScanEngine({
    store,
    api: server.api(),
    eventId: EVENT_ID,
    random: testRandom,
    now: () => clock.ms,
    perfNow: () => clock.perf,
    ...over,
  });
  await engine.load();
  return { engine, store, db, clock };
}
