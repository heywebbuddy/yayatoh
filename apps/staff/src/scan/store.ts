/**
 * The scanner's tables (M7.4b), in the encrypted database: the manifest (header + one row per
 * ticket), what this device admitted and where, who is in which session room, the outbox of scans
 * waiting for the server, and the scans the server judged differently after sync.
 *
 * Plain SQL over the `ScanDb` port. The engine keeps an in-memory index of the rows for speed;
 * these tables are what survives a restart.
 */
import type { ManifestHeader, ManifestRow } from '@yayatoh/checkin-engine';
import type { ScanDb } from './db';
import type { AdmissionInfo, Direction, FlaggedScan, OutboxEntry } from './types';

export const SCHEMA_VERSION = 1;

const TABLES = ['manifest_rows', 'admissions', 'in_room', 'door_log', 'outbox', 'flags', 'meta'] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS manifest_rows (
  ticket_id TEXT PRIMARY KEY NOT NULL,
  short_code TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS manifest_rows_short ON manifest_rows (short_code);
CREATE TABLE IF NOT EXISTS admissions (
  key TEXT PRIMARY KEY NOT NULL,
  at TEXT NOT NULL,
  checkpoint_id TEXT
);
CREATE TABLE IF NOT EXISTS in_room (key TEXT PRIMARY KEY NOT NULL);
CREATE TABLE IF NOT EXISTS door_log (
  scan_id TEXT PRIMARY KEY NOT NULL,
  verdict TEXT NOT NULL,
  checkpoint_id TEXT,
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  device_ts TEXT NOT NULL,
  clock_offset_ms INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  checkpoint_id TEXT,
  direction TEXT,
  ticket_id TEXT,
  holder_name TEXT
);
CREATE TABLE IF NOT EXISTS flags (
  scan_id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT,
  holder_name TEXT,
  local_verdict TEXT NOT NULL,
  server_result TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  found_at TEXT NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0
);
`;

export interface DoorLogRow {
  readonly scanId: string;
  readonly verdict: string;
  readonly checkpointId: string | null;
  readonly syncedAt: string | null;
}

interface OutboxRow {
  scan_id: string;
  code: string;
  device_ts: string;
  clock_offset_ms: number;
  verdict: string;
  checkpoint_id: string | null;
  direction: string | null;
  ticket_id: string | null;
  holder_name: string | null;
}

export class ScanStore {
  constructor(readonly db: ScanDb) {}

  async init(): Promise<void> {
    await this.db.exec(SCHEMA);
    await this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  // --- meta ---------------------------------------------------------------------------------

  async getMeta(key: string): Promise<string | null> {
    const [row] = await this.db.all<{ v: string }>('SELECT v FROM meta WHERE k = ?', [key]);
    return row?.v ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', [
      key,
      value,
    ]);
  }

  async deleteMeta(key: string): Promise<void> {
    await this.db.run('DELETE FROM meta WHERE k = ?', [key]);
  }

  async getHeader(): Promise<ManifestHeader | null> {
    const json = await this.getMeta('header');
    return json ? (JSON.parse(json) as ManifestHeader) : null;
  }

  // --- manifest rows ------------------------------------------------------------------------

  async upsertRows(rows: readonly ManifestRow[]): Promise<void> {
    for (const r of rows) {
      await this.db.run(
        'INSERT INTO manifest_rows (ticket_id, short_code, json) VALUES (?, ?, ?) ON CONFLICT (ticket_id) DO UPDATE SET short_code = excluded.short_code, json = excluded.json',
        [r.ticketId, r.shortCode, JSON.stringify(r)],
      );
    }
  }

  async loadRows(): Promise<ManifestRow[]> {
    const rows = await this.db.all<{ json: string }>('SELECT json FROM manifest_rows');
    return rows.map((r) => JSON.parse(r.json) as ManifestRow);
  }

  /** Every table emptied, in one transaction: the guest list, the queue, the flags, the lot. */
  async clearAll(): Promise<void> {
    await this.db.transaction(async () => {
      for (const table of TABLES) await this.db.run(`DELETE FROM ${table}`);
    });
  }

  async clearManifest(): Promise<void> {
    await this.db.run('DELETE FROM manifest_rows');
    await this.db.run("DELETE FROM meta WHERE k IN ('header', 'cursor', 'last_sync_at')");
  }

  // --- admissions and session rooms ---------------------------------------------------------

  async addAdmission(key: string, info: AdmissionInfo): Promise<void> {
    await this.db.run('INSERT OR IGNORE INTO admissions (key, at, checkpoint_id) VALUES (?, ?, ?)', [
      key,
      info.at,
      info.checkpointId,
    ]);
  }

  async loadAdmissions(): Promise<Map<string, AdmissionInfo>> {
    const rows = await this.db.all<{ key: string; at: string; checkpoint_id: string | null }>(
      'SELECT key, at, checkpoint_id FROM admissions',
    );
    return new Map(rows.map((r) => [r.key, { at: r.at, checkpointId: r.checkpoint_id }]));
  }

  async setInRoom(key: string, present: boolean): Promise<void> {
    if (present) await this.db.run('INSERT OR IGNORE INTO in_room (key) VALUES (?)', [key]);
    else await this.db.run('DELETE FROM in_room WHERE key = ?', [key]);
  }

  async loadInRoom(): Promise<Set<string>> {
    const rows = await this.db.all<{ key: string }>('SELECT key FROM in_room');
    return new Set(rows.map((r) => r.key));
  }

  async addDoorLog(row: DoorLogRow): Promise<void> {
    await this.db.run(
      'INSERT OR REPLACE INTO door_log (scan_id, verdict, checkpoint_id, synced_at) VALUES (?, ?, ?, ?)',
      [row.scanId, row.verdict, row.checkpointId, row.syncedAt],
    );
  }

  async markDoorLogSynced(scanId: string, verdict: string, syncedAt: string): Promise<void> {
    await this.db.run('UPDATE door_log SET verdict = ?, synced_at = ? WHERE scan_id = ?', [
      verdict,
      syncedAt,
      scanId,
    ]);
  }

  async loadDoorLog(): Promise<DoorLogRow[]> {
    const rows = await this.db.all<{
      scan_id: string;
      verdict: string;
      checkpoint_id: string | null;
      synced_at: string | null;
    }>('SELECT scan_id, verdict, checkpoint_id, synced_at FROM door_log');
    return rows.map((r) => ({
      scanId: r.scan_id,
      verdict: r.verdict,
      checkpointId: r.checkpoint_id,
      syncedAt: r.synced_at,
    }));
  }

  /** After a manifest made at `serverTime`: forget door scans it already counts. */
  async pruneDoorLog(serverTime: string): Promise<void> {
    await this.db.run('DELETE FROM door_log WHERE synced_at IS NOT NULL AND synced_at <= ?', [serverTime]);
  }

  // --- outbox -------------------------------------------------------------------------------

  async enqueue(scan: OutboxEntry): Promise<void> {
    await this.db.run(
      'INSERT OR IGNORE INTO outbox (scan_id, code, device_ts, clock_offset_ms, verdict, checkpoint_id, direction, ticket_id, holder_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        scan.scanId,
        scan.code,
        scan.deviceTs,
        scan.clockOffsetMs,
        scan.verdict,
        scan.checkpointId ?? null,
        scan.direction ?? null,
        scan.ticketId,
        scan.holderName,
      ],
    );
  }

  /** The oldest queued scans first (by arrival), at most `limit`. */
  async peek(limit: number): Promise<OutboxEntry[]> {
    const rows = await this.db.all<OutboxRow>(
      'SELECT scan_id, code, device_ts, clock_offset_ms, verdict, checkpoint_id, direction, ticket_id, holder_name FROM outbox ORDER BY seq LIMIT ?',
      [limit],
    );
    return rows.map((r) => ({
      scanId: r.scan_id,
      code: r.code,
      deviceTs: r.device_ts,
      clockOffsetMs: r.clock_offset_ms,
      verdict: r.verdict,
      ...(r.checkpoint_id ? { checkpointId: r.checkpoint_id } : {}),
      ...(r.direction ? { direction: r.direction as Direction } : {}),
      ticketId: r.ticket_id,
      holderName: r.holder_name,
    }));
  }

  async remove(scanIds: readonly string[]): Promise<void> {
    for (const id of scanIds) await this.db.run('DELETE FROM outbox WHERE scan_id = ?', [id]);
  }

  async count(): Promise<number> {
    const [row] = await this.db.all<{ n: number }>('SELECT count(*) AS n FROM outbox');
    return row?.n ?? 0;
  }

  // --- flags --------------------------------------------------------------------------------

  async addFlag(flag: FlaggedScan): Promise<void> {
    await this.db.run(
      'INSERT OR REPLACE INTO flags (scan_id, ticket_id, holder_name, local_verdict, server_result, scanned_at, found_at, dismissed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        flag.scanId,
        flag.ticketId,
        flag.holderName,
        flag.localVerdict,
        flag.serverResult,
        flag.scannedAt,
        flag.foundAt,
        flag.dismissed ? 1 : 0,
      ],
    );
  }

  async listFlags(): Promise<FlaggedScan[]> {
    const rows = await this.db.all<{
      scan_id: string;
      ticket_id: string | null;
      holder_name: string | null;
      local_verdict: string;
      server_result: string;
      scanned_at: string;
      found_at: string;
      dismissed: number;
    }>('SELECT * FROM flags ORDER BY found_at DESC, scan_id');
    return rows.map((r) => ({
      scanId: r.scan_id,
      ticketId: r.ticket_id,
      holderName: r.holder_name,
      localVerdict: r.local_verdict,
      serverResult: r.server_result,
      scannedAt: r.scanned_at,
      foundAt: r.found_at,
      dismissed: r.dismissed === 1,
    }));
  }

  async dismissFlag(scanId: string): Promise<void> {
    await this.db.run('UPDATE flags SET dismissed = 1 WHERE scan_id = ?', [scanId]);
  }

  async dismissAllFlags(): Promise<void> {
    await this.db.run('UPDATE flags SET dismissed = 1');
  }
}
