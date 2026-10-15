/**
 * The scanner's engine (M7.4b): the manifest on the phone, verdicts, and the outbox.
 *
 * - **Verdicts** come from `@yayatoh/checkin-engine` only (`offlineVerdict`); nothing here decides
 *   whether a ticket is good. The engine feeds it the manifest, what this device already admitted
 *   and the corrected clock, then records the answer.
 * - **Offline first:** a scan is decided and saved (admission + outbox row, one transaction) before
 *   the verdict is returned, so a crash right after cannot lose a scan.
 * - **Sync:** the outbox goes to `scans/batch` in batches of up to 500, oldest first, with
 *   exponential backoff. The server applies each scan id once and is first-wins across devices; a
 *   scan it judges differently (a duplicate another door admitted first) is kept as a flag.
 *
 * Plain TypeScript: SQLite, the clock, randomness and the network are injected, so it runs under
 * Jest with Node's SQLite and a fake server.
 */
import {
  admittedKey,
  clockOffsetMs,
  eventDay,
  legacyIndex,
  MANIFEST_VERSION,
  type ManifestHeader,
  type ManifestRow,
  offlineVerdict,
  verifyManifestScope,
} from '@yayatoh/checkin-engine';
import { type ScanApi, ScanAuthError, ScanRejectedError, ScanSyncError } from './api';
import { backoffMs } from './backoff';
import { uuidv7 } from './ids';
import { applyDoorVerdict, sessionOccupancy } from './session-door';
import type { DoorLogRow, ScanStore } from './store';
import { TimingLog } from './timing';
import type { AdmissionInfo, Direction, FlaggedScan, OutboxEntry, RandomBytes, ScanOutcome } from './types';

/** Stop scanning with the downloaded list this long after the event ends (ADR 0011). */
export const EXPIRY_MS = 24 * 3_600_000;
/** The server takes at most this many scans per request. */
export const BATCH_SIZE = 500;
/** The `code` field of a scan is at most this long on the wire. */
export const MAX_CODE_LENGTH = 400;
const PAGE_SIZE = 2000;

export type Phase = 'empty' | 'ready' | 'expired';

export interface EngineStatus {
  readonly phase: Phase;
  readonly eventName: string | null;
  readonly ticketCount: number;
  readonly lastSyncAt: string | null;
  readonly queueDepth: number;
  /** Scans the server judged differently that nobody has dismissed. */
  readonly flaggedCount: number;
  readonly syncing: boolean;
  readonly flushing: boolean;
  /** The server refused the device token: the device layer wipes and re-enrols. */
  readonly unauthorized: boolean;
  /** Why the last manifest download failed, if it did. */
  readonly syncError: 'offline' | 'not_assigned' | 'bad_scope' | null;
}

export interface FlushResult {
  readonly sent: number;
  readonly remaining: number;
  /** Scans flagged by this flush. */
  readonly flagged: readonly FlaggedScan[];
  /** True when the flush did not run because the backoff has not elapsed. */
  readonly skipped: boolean;
  readonly error: 'offline' | 'unauthorized' | null;
}

export interface EngineDeps {
  readonly store: ScanStore;
  readonly api: ScanApi;
  readonly eventId: string;
  readonly random: RandomBytes;
  /** Wall clock, ms. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** A high resolution timer for the 300 ms measurement. Defaults to `performance.now`. */
  readonly perfNow?: () => number;
  /** Called when the list has expired (24 h after the event) and been cleared: delete the file. */
  readonly onExpired?: () => void | Promise<void>;
}

/** A scan was tried before any guest list was downloaded. */
export class ScanUnavailableError extends Error {
  constructor(readonly phase: Phase) {
    super(`scanning is not available: ${phase}`);
    this.name = 'ScanUnavailableError';
  }
}

const POSITIVE: ReadonlySet<string> = new Set(['admit', 'provisional', 'granted', 'entered', 'scanned_out']);
const CONFIRMING: ReadonlySet<string> = new Set([
  'admitted',
  'provisional',
  'granted',
  'entered',
  'scanned_out',
]);

/** True when the phone let someone in and the server says it should not have (or not that way). */
export const disagrees = (local: string, server: string) => POSITIVE.has(local) && !CONFIRMING.has(server);

export class ScanEngine {
  private header: ManifestHeader | null = null;
  private lastSync: string | null = null;
  private cursor: string | null = null;
  private clockOffset = 0;
  private byId = new Map<string, ManifestRow>();
  private byShort = new Map<string, ManifestRow>();
  private byLegacy = new Map<string, ManifestRow>();
  private admitted = new Map<string, AdmissionInfo>();
  /** The keys of `admitted`, kept as a set so a scan never copies it. */
  private admittedKeys = new Set<string>();
  private inRoom = new Set<string>();
  private doorLog: DoorLogRow[] = [];
  private depth = 0;
  private flagged = 0;
  private checkpointId: string | null = null;
  private failures = 0;
  private retryAt = 0;
  private lock: Promise<unknown> = Promise.resolve();
  private flushing: Promise<FlushResult> | null = null;
  private syncing: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private current: EngineStatus;
  private unauthorized = false;
  private syncError: EngineStatus['syncError'] = null;
  private expired = false;
  /** How long recent verdicts took (the 300 ms budget); read by the device pass. */
  readonly timings = new TimingLog();

  private readonly now: () => number;
  private readonly perfNow: () => number;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now;
    this.perfNow = deps.perfNow ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.current = this.build();
  }

  // --- state for the screens ----------------------------------------------------------------

  get status(): EngineStatus {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private build(): EngineStatus {
    return {
      phase: this.expired ? 'expired' : this.header ? 'ready' : 'empty',
      eventName: this.header?.event.name ?? null,
      ticketCount: this.byId.size,
      lastSyncAt: this.lastSync,
      queueDepth: this.depth,
      flaggedCount: this.flagged,
      syncing: this.syncing !== null,
      flushing: this.flushing !== null,
      unauthorized: this.unauthorized,
      syncError: this.syncError,
    };
  }

  private publish(): void {
    const next = this.build();
    const prev = this.current;
    if ((Object.keys(next) as (keyof EngineStatus)[]).every((k) => next[k] === prev[k])) return;
    this.current = next;
    for (const l of this.listeners) l();
  }

  get checkpoints(): ManifestHeader['checkpoints'] {
    return this.header?.checkpoints ?? [];
  }

  /** The chosen checkpoint if the manifest still has it; an archived one falls back to the whole event. */
  get checkpoint(): ManifestHeader['checkpoints'][number] | null {
    return this.checkpoints.find((c) => c.id === this.checkpointId) ?? null;
  }

  get timezone(): string | null {
    return this.header?.event.timezone ?? null;
  }

  setCheckpoint(id: string | null): void {
    this.checkpointId = id;
  }

  /** The session behind the chosen checkpoint when it is a session door. */
  get sessionDoor(): { checkpointId: string; sessionId: string; title: string | null } | null {
    const c = this.checkpoint;
    if (c?.kind !== 'session' || !c.sessionId) return null;
    const s = this.header?.sessions?.find((x) => x.checkpointId === c.id);
    return { checkpointId: c.id, sessionId: c.sessionId, title: s?.title ?? null };
  }

  /** When the downloaded list stops being usable (24 h after the event ends); null before a download. */
  get expiresAt(): Date | null {
    return this.header ? new Date(new Date(this.header.event.endsAt).getTime() + EXPIRY_MS) : null;
  }

  // --- loading and expiry -------------------------------------------------------------------

  /** Reads the saved manifest and queue into memory. Expired lists are cleared, not loaded. */
  async load(): Promise<void> {
    const { store } = this.deps;
    this.header = await store.getHeader();
    this.cursor = await store.getMeta('cursor');
    this.lastSync = await store.getMeta('last_sync_at');
    this.clockOffset = Number(await store.getMeta('clock_offset_ms')) || 0;
    if (this.header && this.isExpired()) {
      await this.expire();
      return;
    }
    this.index(await store.loadRows());
    this.admitted = await store.loadAdmissions();
    this.admittedKeys = new Set(this.admitted.keys());
    this.inRoom = await store.loadInRoom();
    this.doorLog = await store.loadDoorLog();
    this.depth = await store.count();
    this.flagged = (await store.listFlags()).filter((f) => !f.dismissed).length;
    this.publish();
  }

  private isExpired(): boolean {
    const at = this.expiresAt;
    return at !== null && this.now() > at.getTime();
  }

  /**
   * Clears the guest list once it has expired. Tries one last send of the queue first; whatever is
   * still unsent is lost with the list (the privacy rule outranks it). True when it expired.
   */
  async expireIfDue(): Promise<boolean> {
    if (this.expired) return true;
    if (!this.header || !this.isExpired()) return false;
    await this.flush({ force: true }).catch(() => {});
    await this.expire();
    return true;
  }

  private async expire(): Promise<void> {
    await this.clearAll();
    this.expired = true;
    this.publish();
    await this.deps.onExpired?.();
  }

  /** Remote wipe or expiry: forget the manifest, the queue and everything else in memory and in the tables. */
  async clearAll(): Promise<void> {
    await this.serial(async () => {
      await this.deps.store.clearAll();
      this.header = null;
      this.cursor = null;
      this.lastSync = null;
      this.byId = new Map();
      this.byShort = new Map();
      this.byLegacy = new Map();
      this.admitted = new Map();
      this.admittedKeys = new Set();
      this.inRoom = new Set();
      this.doorLog = [];
      this.depth = 0;
      this.flagged = 0;
    });
    this.publish();
  }

  private index(rows: readonly ManifestRow[]): void {
    this.byId = new Map(rows.map((r) => [r.ticketId, r]));
    this.byShort = new Map(rows.map((r) => [r.shortCode, r]));
    this.byLegacy = legacyIndex(rows);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  // --- the manifest -------------------------------------------------------------------------

  /** Downloads manifest changes since the last sync. One run at a time; later calls share it. */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
      this.publish();
    });
    this.publish();
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    const { store, api, eventId } = this.deps;
    // A list from an older manifest format has no signed scope: fetch it again from scratch.
    const current = (this.header?.version ?? 1) >= MANIFEST_VERSION;
    let cursor = this.header && !current ? null : this.cursor;
    if (this.header && !current) {
      await store.clearManifest();
      this.byId = new Map();
      this.byShort = new Map();
      this.byLegacy = new Map();
    }
    let first = true;
    let offset = this.clockOffset;
    let latest: ManifestHeader | null = null;
    try {
      for (;;) {
        const sentAt = this.now();
        const page = await api.manifestPage(eventId, {
          cursor,
          overlap: cursor !== null && first,
          limit: PAGE_SIZE,
        });
        const receivedAt = this.now();
        // The scope is signed with the organization's key: a manifest whose scope does not verify
        // is never used (a tampered response cannot widen where this device may scan).
        if (!(await verifyManifestScope(page.header))) throw new ScanSyncError('bad_scope');
        offset = clockOffsetMs({
          serverTime: new Date(page.header.serverTime).getTime(),
          sentAt,
          receivedAt,
        });
        latest = page.header;
        await this.serial(async () => {
          await store.db.transaction(async () => {
            await store.upsertRows(page.rows);
            if (page.cursor) await store.setMeta('cursor', page.cursor);
          });
          for (const r of page.rows) {
            // A reissued (claimed) ticket gets a new short code: the old one stops working offline.
            const prev = this.byId.get(r.ticketId);
            if (prev && prev.shortCode !== r.shortCode) this.byShort.delete(prev.shortCode);
            this.byId.set(r.ticketId, r);
            this.byShort.set(r.shortCode, r);
          }
        });
        cursor = page.cursor;
        first = false;
        if (page.complete) break;
      }
      if (!latest) return;
      const header = latest;
      await this.serial(async () => {
        await store.db.transaction(async () => {
          await store.setMeta('header', JSON.stringify(header));
          await store.setMeta('last_sync_at', header.serverTime);
          await store.setMeta('clock_offset_ms', String(offset));
          if (cursor) await store.setMeta('cursor', cursor);
          await store.pruneDoorLog(header.serverTime);
        });
        this.header = header;
        this.cursor = cursor;
        this.lastSync = header.serverTime;
        this.clockOffset = offset;
        this.byLegacy = legacyIndex(this.byId.values());
        this.doorLog = await store.loadDoorLog();
      });
      this.syncError = null;
    } catch (e) {
      if (e instanceof ScanAuthError) this.unauthorized = true;
      this.syncError =
        e instanceof ScanSyncError ? e.reason : e instanceof ScanAuthError ? this.syncError : 'offline';
      throw e;
    }
  }

  // --- scanning -----------------------------------------------------------------------------

  /** Decides a code locally, records it and queues it. The verdict never waits for the network. */
  scan(rawCode: string, opts: { direction?: Direction } = {}): Promise<ScanOutcome> {
    const started = this.perfNow();
    return this.serial(() => this.decide(rawCode, opts.direction ?? 'in', started));
  }

  private async decide(rawCode: string, direction: Direction, started: number): Promise<ScanOutcome> {
    const header = this.header;
    if (!header || this.expired) throw new ScanUnavailableError(this.expired ? 'expired' : 'empty');
    const { store, random } = this.deps;
    const code = rawCode.trim();
    const wallNow = this.now();
    const now = new Date(wallNow + this.clockOffset);
    const door = this.sessionDoor;
    const checkpointId = this.checkpoint?.id ?? null;
    const day = eventDay(now, header.event.timezone);
    const result = await offlineVerdict(
      {
        header,
        byId: this.byId,
        byShortCode: this.byShort,
        byLegacyCode: this.byLegacy,
        admitted: this.admittedKeys,
        lastSyncAt: new Date(this.lastSync ?? header.serverTime),
        inRoom: this.inRoom,
        occupancy: door ? sessionOccupancy(header, this.doorLog) : new Map(),
      },
      code,
      now,
      checkpointId,
      { direction },
    );
    const { verdict, ticketId, row } = result;

    const firstAdmission =
      verdict === 'duplicate' && ticketId
        ? this.describeAdmission(this.admitted.get(admittedKey(ticketId, day)), header)
        : null;

    // Remember an admission (not at a session door, which keeps attendance instead).
    const admission: AdmissionInfo | null =
      (verdict === 'admit' || verdict === 'provisional') && ticketId && !door
        ? { at: new Date(wallNow).toISOString(), checkpointId }
        : null;
    const roomChange = door ? applyDoorVerdict(this.inRoom, verdict, ticketId, door.sessionId) : null;
    // A code that cannot fit the wire format is judged but never sent (the server would refuse the batch).
    const sendable = code.length > 0 && code.length <= MAX_CODE_LENGTH;
    const scanId = uuidv7(random, wallNow);
    const entry: OutboxEntry = {
      scanId,
      code,
      deviceTs: new Date(wallNow).toISOString(),
      clockOffsetMs: Math.round(this.clockOffset),
      verdict,
      ...(checkpointId ? { checkpointId } : {}),
      ...(door ? { direction } : {}),
      ticketId,
      holderName: row?.holderName ?? null,
    };
    const doorRow: DoorLogRow | null = door
      ? { scanId, verdict, checkpointId: door.checkpointId, syncedAt: null }
      : null;

    await store.db.transaction(async () => {
      if (admission && ticketId) await store.addAdmission(admittedKey(ticketId, day), admission);
      if (roomChange) await store.setInRoom(roomChange.key, roomChange.present);
      if (doorRow) await store.addDoorLog(doorRow);
      if (sendable) await store.enqueue(entry);
    });
    // Only now is the scan safe: update the in-memory view.
    if (admission && ticketId) {
      this.admitted.set(admittedKey(ticketId, day), admission);
      this.admittedKeys.add(admittedKey(ticketId, day));
    }
    if (doorRow) this.doorLog.push(doorRow);
    if (sendable) this.depth += 1;
    this.publish();

    const elapsedMs = this.perfNow() - started;
    this.timings.add(elapsedMs);
    return {
      scanId,
      verdict,
      ticketId,
      holderName: row?.holderName ?? null,
      typeName: row?.typeName ?? null,
      firstAdmission,
      elapsedMs,
    };
  }

  private describeAdmission(info: AdmissionInfo | undefined, header: ManifestHeader) {
    if (!info) return null;
    const name = info.checkpointId ? header.checkpoints.find((c) => c.id === info.checkpointId)?.name : null;
    return { at: info.at, checkpointName: name ?? null };
  }

  // --- the outbox ---------------------------------------------------------------------------

  /** Scans waiting for the server (the heartbeat reports this). */
  get queueDepth(): number {
    return this.depth;
  }

  /**
   * Sends the queue. One run at a time (a scan, the timer and a reconnect can all ask at once; later
   * callers share the run). Each scan leaves the queue only after the server answered for it, and
   * the server applies a scan id once, so a flush cut off half-way is simply sent again.
   */
  flush(opts: { force?: boolean } = {}): Promise<FlushResult> {
    if (this.flushing) return this.flushing;
    if (!opts.force && this.now() < this.retryAt) {
      return Promise.resolve({ sent: 0, remaining: this.depth, flagged: [], skipped: true, error: null });
    }
    if (this.unauthorized) {
      return Promise.resolve({
        sent: 0,
        remaining: this.depth,
        flagged: [],
        skipped: false,
        error: 'unauthorized',
      });
    }
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
      this.publish();
    });
    this.publish();
    return this.flushing;
  }

  /** The earliest time an automatic retry should run (0 when the last attempt succeeded). */
  get nextAttemptAt(): number {
    return this.retryAt;
  }

  private async runFlush(): Promise<FlushResult> {
    const { store } = this.deps;
    let sent = 0;
    const flagged: FlaggedScan[] = [];
    for (;;) {
      const batch = await store.peek(BATCH_SIZE);
      if (batch.length === 0) break;
      try {
        sent += await this.sendBatch(batch, flagged);
      } catch (e) {
        if (e instanceof ScanAuthError) {
          this.unauthorized = true;
          return { sent, remaining: this.depth, flagged, skipped: false, error: 'unauthorized' };
        }
        this.failures += 1;
        this.retryAt = this.now() + backoffMs(this.failures, Math.random());
        return { sent, remaining: this.depth, flagged, skipped: false, error: 'offline' };
      }
    }
    this.failures = 0;
    this.retryAt = 0;
    return { sent, remaining: this.depth, flagged, skipped: false, error: null };
  }

  /** Sends one batch; a batch the server refuses as malformed is halved until the bad scan stands alone. */
  private async sendBatch(batch: readonly OutboxEntry[], flagged: FlaggedScan[]): Promise<number> {
    const { store, api, eventId } = this.deps;
    let response: Awaited<ReturnType<ScanApi['syncScans']>>;
    try {
      response = await api.syncScans(
        eventId,
        batch.map(({ ticketId: _t, holderName: _h, ...wire }) => wire),
      );
    } catch (e) {
      if (!(e instanceof ScanRejectedError)) throw e;
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        return (
          (await this.sendBatch(batch.slice(0, mid), flagged)) +
          (await this.sendBatch(batch.slice(mid), flagged))
        );
      }
      // One scan the server will never take: drop it, and say so rather than retry forever.
      const only = batch[0] as OutboxEntry;
      const flag = this.flagFor(only, 'rejected');
      await this.serial(async () => {
        await store.db.transaction(async () => {
          await store.addFlag(flag);
          await store.remove([only.scanId]);
        });
        this.depth = Math.max(0, this.depth - 1);
        this.flagged += 1;
      });
      flagged.push(flag);
      return 0;
    }
    const byId = new Map(response.results.map((r) => [r.scanId, r]));
    const syncedAt = new Date(this.now() + this.clockOffset).toISOString();
    const newFlags: FlaggedScan[] = [];
    for (const s of batch) {
      const r = byId.get(s.scanId);
      if (r && disagrees(s.verdict, r.result)) newFlags.push(this.flagFor(s, r.result));
    }
    await this.serial(async () => {
      await store.db.transaction(async () => {
        for (const f of newFlags) await store.addFlag(f);
        for (const s of batch) {
          const r = byId.get(s.scanId);
          // Door scans now count on the server: the next manifest made after this includes them.
          if (this.doorLog.some((d) => d.scanId === s.scanId && !d.syncedAt))
            await store.markDoorLogSynced(s.scanId, r?.result ?? s.verdict, syncedAt);
        }
        await store.remove(batch.map((s) => s.scanId));
      });
      this.doorLog = this.doorLog.map((d) => {
        const r = byId.get(d.scanId);
        return r && !d.syncedAt ? { ...d, verdict: r.result, syncedAt } : d;
      });
      this.depth = Math.max(0, this.depth - batch.length);
      this.flagged += newFlags.length;
    });
    flagged.push(...newFlags);
    this.publish();
    return batch.length;
  }

  private flagFor(s: OutboxEntry, serverResult: string): FlaggedScan {
    return {
      scanId: s.scanId,
      ticketId: s.ticketId,
      holderName: s.holderName,
      localVerdict: s.verdict,
      serverResult,
      scannedAt: s.deviceTs,
      foundAt: new Date(this.now()).toISOString(),
      dismissed: false,
    };
  }

  // --- flags --------------------------------------------------------------------------------

  flags(): Promise<FlaggedScan[]> {
    return this.deps.store.listFlags();
  }

  async dismissFlag(scanId: string): Promise<void> {
    await this.deps.store.dismissFlag(scanId);
    this.flagged = (await this.deps.store.listFlags()).filter((f) => !f.dismissed).length;
    this.publish();
  }

  async dismissAllFlags(): Promise<void> {
    await this.deps.store.dismissAllFlags();
    this.flagged = 0;
    this.publish();
  }
}
