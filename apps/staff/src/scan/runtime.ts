/**
 * The scanner as the app holds it (M7.4b): one database, one engine and one scheduler per enrolled
 * event, opened when the scan screen needs them and destroyed when the device is wiped, signed out
 * or the list expires.
 *
 * The wipe is deliberately independent of any screen: a remote wipe can arrive while the scan
 * screen is not mounted, so `registerScanWipe` is called once at app start (root layout) and
 * `wipeScanData` works from the keychain and the file name alone, closing whatever is open first.
 */
import type { KeyValueStore } from '@yayatoh/mobile-core';
import type { RandomBytes } from './types';
import { type ScanApi } from './api';
import { destroyScanDb, type ScanDb, type SqliteModule } from './db';
import { ScanEngine } from './engine';
import { createScheduler, type Scheduler } from './scheduler';
import { ScanStore } from './store';

export interface ScanRuntime {
  readonly engine: ScanEngine;
  readonly scheduler: Scheduler;
  readonly eventId: string;
  close(): Promise<void>;
}

export interface RuntimeDeps {
  readonly eventId: string;
  readonly api: ScanApi;
  readonly random: RandomBytes;
  readonly storage: KeyValueStore;
  readonly sqlite: SqliteModule;
  readonly openDb: () => Promise<ScanDb>;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}

let current: ScanRuntime | null = null;

/** Opens the database for `eventId`. A database left by another event is emptied first. */
export async function openScanRuntime(deps: RuntimeDeps): Promise<ScanRuntime> {
  if (current?.eventId === deps.eventId) return current;
  await current?.close();
  current = null;
  const db = await deps.openDb();
  const store = new ScanStore(db);
  await store.init();
  const stored = await store.getMeta('event_id');
  if (stored && stored !== deps.eventId) await store.clearAll();
  await store.setMeta('event_id', deps.eventId);

  let runtime: ScanRuntime | null = null;
  const engine = new ScanEngine({
    store,
    api: deps.api,
    eventId: deps.eventId,
    random: deps.random,
    ...(deps.now ? { now: deps.now } : {}),
    // The list has expired and been emptied: take the file and the key with it.
    onExpired: async () => {
      await runtime?.close();
      await destroyScanDb(deps.sqlite, deps.storage);
      if (current === runtime) current = null;
    },
  });
  await engine.load();
  // `load` can find an expired list; the store is gone then, and so is the database.
  const scheduler = createScheduler({ engine, ...(deps.now ? { now: deps.now } : {}), ...(deps.onError ? { onError: deps.onError } : {}) });
  runtime = {
    engine,
    scheduler,
    eventId: deps.eventId,
    async close() {
      scheduler.stop();
      if (current === runtime) current = null;
      await db.close().catch(() => {});
    },
  };
  current = runtime;
  return runtime;
}

/** The runtime that is open now, if any. */
export const currentScanRuntime = (): ScanRuntime | null => current;

/** Remote wipe, revocation or sign-out: stop, close and delete the database and its key. */
export async function wipeScanData(deps: { storage: KeyValueStore; sqlite: SqliteModule }): Promise<void> {
  const open = current;
  current = null;
  if (open) {
    open.scheduler.stop();
    // Empty the tables first: if the file cannot be deleted right now, nothing readable is left.
    await open.engine.clearAll().catch(() => {});
    await open.close();
  }
  await destroyScanDb(deps.sqlite, deps.storage);
}

/** M7.4a's `onWipe(callback)`: may return an unsubscribe function. */
export type OnWipe = (callback: () => void | Promise<void>) => void | (() => void);

/** Wires the wipe to the device layer. Call once at app start. Returns an unsubscribe. */
export function registerScanWipe(
  onWipe: OnWipe,
  deps: { storage: KeyValueStore; sqlite: SqliteModule },
): () => void {
  const off = onWipe(() => wipeScanData(deps));
  return typeof off === 'function' ? off : () => {};
}
