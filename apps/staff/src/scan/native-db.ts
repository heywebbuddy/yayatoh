/**
 * The phone's database (M7.4b): `expo-sqlite` built with SQLCipher (the `expo-sqlite` config plugin
 * in `app.config.ts` sets `useSQLCipher`), keyed from the keychain. The only file that imports the
 * native module.
 */

import type { KeyValueStore } from '@yayatoh/mobile-core';
import * as SQLite from 'expo-sqlite';
import {
  destroyScanDb,
  openEncryptedScanDb,
  type ScanDb,
  ScanDbKeyError,
  type SqliteModule,
  scanDbKey,
} from './db';
import type { RandomBytes } from './types';

/** `expo-sqlite` as the small interface the adapter needs. */
export const nativeSqlite: SqliteModule = {
  openDatabaseAsync: (name) => SQLite.openDatabaseAsync(name),
  deleteDatabaseAsync: (name) => SQLite.deleteDatabaseAsync(name),
};

/**
 * Opens the scan database with the keychain's key. A file the key cannot open (the key was lost, for
 * example after restoring a backup) holds nothing that can be read: it is deleted and started again,
 * and the guest list downloads afresh.
 */
export async function openNativeScanDb(
  storage: KeyValueStore,
  random: RandomBytes,
  sqlite: SqliteModule = nativeSqlite,
): Promise<ScanDb> {
  const key = await scanDbKey(storage, random);
  try {
    return await openEncryptedScanDb(sqlite, key);
  } catch (e) {
    if (!(e instanceof ScanDbKeyError)) throw e;
    await destroyScanDb(sqlite, storage);
    return openEncryptedScanDb(sqlite, await scanDbKey(storage, random));
  }
}

export const destroyNativeScanDb = (storage: KeyValueStore, sqlite: SqliteModule = nativeSqlite) =>
  destroyScanDb(sqlite, storage);
