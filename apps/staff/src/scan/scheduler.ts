/**
 * Keeps the scanner in step with the server while the app is open (M7.4b): sends the outbox soon
 * after a scan and the moment the network comes back, retries on the backoff, refreshes the
 * manifest every few minutes, and clears an expired list.
 *
 * "In the background" here means off the scanning path: nothing waits on it. An OS background task
 * (the app closed) is a later increment; a door phone sits open on the scan screen.
 */
import type { ScanEngine } from './engine';

/** How often the loop wakes to retry the outbox, refresh the list and check expiry. */
export const TICK_MS = 10_000;
/** The manifest refresh interval. */
export const MANIFEST_REFRESH_MS = 5 * 60_000;

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** The phone's connectivity changed. Coming back online sends the queue and refreshes the list now. */
  setOnline(online: boolean): void;
  /** A scan was made: send it soon. */
  kick(): void;
  /** Send and refresh now (a staff member pressed "sync"). */
  syncNow(): Promise<void>;
}

export interface SchedulerOptions {
  readonly engine: ScanEngine;
  readonly timers?: Timers;
  readonly now?: () => number;
  readonly online?: boolean;
  /** Called with errors that are not just "offline" (never with scan data). */
  readonly onError?: (error: unknown) => void;
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { engine } = options;
  const timers: Timers = options.timers ?? globalThis;
  const now = options.now ?? Date.now;
  let handle: unknown = null;
  let online = options.online ?? true;
  let lastRefresh = 0;
  let running = false;

  const quiet = (p: Promise<unknown>) => p.catch(options.onError ?? (() => {}));

  const refresh = async () => {
    lastRefresh = now();
    await engine.sync();
  };

  const tick = () => {
    if (!running) return;
    void quiet(engine.expireIfDue());
    if (!online || engine.status.phase === 'expired') return;
    if (engine.queueDepth > 0) void quiet(engine.flush());
    const empty = engine.status.phase === 'empty';
    if (!engine.status.unauthorized && (empty || now() - lastRefresh >= MANIFEST_REFRESH_MS))
      void quiet(refresh());
  };

  return {
    start() {
      if (running) return;
      running = true;
      if (online) {
        void quiet(engine.flush({ force: true }));
        void quiet(refresh());
      }
      handle = timers.setInterval(tick, TICK_MS);
    },
    stop() {
      running = false;
      if (handle !== null) timers.clearInterval(handle);
      handle = null;
    },
    setOnline(next) {
      const was = online;
      online = next;
      if (!running || !next || was) return;
      // Back online: do not wait for the tick or the backoff.
      void quiet(engine.flush({ force: true }));
      void quiet(refresh());
    },
    kick() {
      if (running && online) void quiet(engine.flush());
    },
    async syncNow() {
      await engine.flush({ force: true });
      await refresh();
    },
  };
}
