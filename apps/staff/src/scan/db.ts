/**
 * The seam between the scanner and SQLite (M7.4b). The engine only sees `ScanDb`; on a phone it is
 * `expo-sqlite` built with SQLCipher (`openEncryptedScanDb`), under Jest it is Node's own SQLite.
 *
 * The manifest holds every ticket holder's name and hashed contact details for the event, so the
 * file is encrypted with a random 256-bit key that lives only in the keychain (`expo-secure-store`,
 * this device only). Deleting the key makes the file unreadable even if a copy of it survives.
 */
import type { KeyValueStore } from '@yayatoh/mobile-core';
import type { RandomBytes } from './types';

export type SqlValue = string | number | null;

export interface ScanDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Runs `fn` in one transaction: all its writes land, or none do. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The part of `expo-sqlite` the adapter uses, so tests can stand in for the native module. */
export interface SqliteModule {
  openDatabaseAsync(name: string): Promise<SqliteHandle>;
  deleteDatabaseAsync(name: string): Promise<void>;
}
export interface SqliteHandle {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}

export const DB_NAME = 'yayatoh-scan.db';
export const DB_KEY_NAME = 'scan.db.key';

/** The database could not be opened with the key in the keychain (a different or lost key). */
export class ScanDbKeyError extends Error {
  constructor() {
    super('scan database cannot be opened with the stored key');
    this.name = 'ScanDbKeyError';
  }
}

const HEX_KEY = /^[0-9a-f]{64}$/;

/** The key in the keychain, made on first use. 256 random bits, as hex. */
export async function scanDbKey(storage: KeyValueStore, random: RandomBytes): Promise<string> {
  const stored = await storage.get(DB_KEY_NAME);
  if (stored && HEX_KEY.test(stored)) return stored;
  const key = Array.from(random(32), (b: number) => b.toString(16).padStart(2, '0')).join('');
  await storage.set(DB_KEY_NAME, key);
  return key;
}

/**
 * Opens (or creates) the encrypted database. `PRAGMA key` must be the first statement; the raw-key
 * form (`x'…'`) skips the passphrase derivation, which is slow on a phone. A wrong key shows up on
 * the first read, as SQLCipher's "file is not a database", and becomes `ScanDbKeyError`.
 */
export async function openEncryptedScanDb(
  sqlite: SqliteModule,
  key: string,
  name = DB_NAME,
): Promise<ScanDb> {
  if (!HEX_KEY.test(key)) throw new Error('scan database key must be 64 hex characters');
  const handle = await sqlite.openDatabaseAsync(name);
  try {
    await handle.execAsync(`PRAGMA key = "x'${key}'";`);
    await handle.getAllAsync('SELECT count(*) AS n FROM sqlite_master', []);
    await handle.execAsync(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;',
    );
  } catch {
    await handle.closeAsync().catch(() => {});
    throw new ScanDbKeyError();
  }
  return wrapHandle(handle);
}

/** Wraps a handle in the `ScanDb` interface; transactions are serialized (SQLite has one writer). */
export function wrapHandle(handle: SqliteHandle): ScanDb {
  let tail: Promise<unknown> = Promise.resolve();
  let depth = 0;
  const db: ScanDb = {
    exec: (sql) => handle.execAsync(sql),
    run: async (sql, params = []) => {
      await handle.runAsync(sql, [...params]);
    },
    all: (sql, params = []) => handle.getAllAsync(sql, [...params]),
    transaction: async <T>(fn: () => Promise<T>): Promise<T> => {
      if (depth > 0) return fn();
      const run = async () => {
        depth++;
        await handle.execAsync('BEGIN IMMEDIATE');
        try {
          const out = await fn();
          await handle.execAsync('COMMIT');
          return out;
        } catch (e) {
          await handle.execAsync('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          depth--;
        }
      };
      const next = tail.then(run, run);
      tail = next.catch(() => {});
      return next;
    },
    close: () => handle.closeAsync(),
  };
  return db;
}

/** Deletes the database files and the key: after this the data cannot be read by anyone. */
export async function destroyScanDb(
  sqlite: SqliteModule,
  storage: KeyValueStore,
  name = DB_NAME,
): Promise<void> {
  await sqlite.deleteDatabaseAsync(name).catch(() => {});
  await storage.delete(DB_KEY_NAME);
}
