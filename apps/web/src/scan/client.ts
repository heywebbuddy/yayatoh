import {
  admittedKey,
  eventDay,
  legacyIndex,
  MANIFEST_VERSION,
  type ManifestHeader,
  type ManifestRow,
  type OfflineVerdict,
  offlineVerdict,
  verifyManifestScope,
} from '@yayatoh/checkin-engine';
import { uuidv7 } from '@yayatoh/kernel';
import {
  kvGet,
  kvSet,
  openJson,
  type QueuedScan,
  queueAdd,
  queueAll,
  queueRemove,
  sealJson,
  wipeAll,
} from './store.ts';
import { chunk, dedupeQueue, isNewDirective, singleFlight } from './sync-queue.ts';

export interface ScanConfig {
  readonly eventId: string;
  readonly token: string;
}

interface Snapshot {
  header: ManifestHeader;
  rows: ManifestRow[];
  cursor: string | null;
  lastSyncAt: string;
  admitted: string[];
}

export type ServerResult =
  | 'admitted'
  | 'duplicate'
  | 'invalid'
  | 'void'
  | 'wrong_event'
  | 'not_today'
  | 'wrong_date'
  | 'outside_window'
  | 'duplicate_offline'
  | 'superseded'
  | 'provisional'
  | 'granted'
  | 'no_access'
  | 'wrong_checkpoint';

/** A sync the server refused for a reason the scanner should show (not just "offline"). */
export class ScanSyncError extends Error {
  constructor(readonly reason: 'not_assigned' | 'bad_scope') {
    super(reason);
  }
}

export interface ScanOutcome {
  readonly scanId: string;
  readonly verdict: OfflineVerdict;
  readonly holderName: string | null;
  readonly typeName: string | null;
  /** Set once the server has reconciled this scan (it may disagree with the local verdict). */
  readonly server: ServerResult | null;
  /** Open high-severity fraud signals the server knows about this ticket (M1.9e; online only). */
  readonly openSignals?: number;
}

/** The server's answer for one queued scan. */
export interface ServerScan {
  readonly result: ServerResult;
  readonly openSignals: number;
}

/** The staff mode screen as `/api/scan/staff` returns it (dates as ISO strings). */
export interface StaffView {
  readonly eventId: string;
  readonly eventName: string;
  readonly timezone: string;
  readonly day: string;
  readonly asOf: string;
  readonly checkedIn: number;
  readonly expected: number;
  readonly byEntrance: readonly { checkpointId: string; name: string; checkedIn: number }[];
  readonly byDate: readonly { day: string; checkedIn: number }[];
  readonly devices: readonly {
    id: string;
    label: string;
    online: boolean;
    lastSeenAt: string | null;
    batteryPct: number | null;
    queueDepth: number | null;
    checkpointId: string | null;
    mode: 'scanner' | 'kiosk';
    self: boolean;
  }[];
  readonly alerts: readonly {
    key: string;
    kind: 'device_offline' | 'device_low_battery' | 'device_backlog' | 'capacity_near';
    severity: 'warning' | 'critical';
    deviceId: string | null;
    deviceLabel: string | null;
    percent: number | null;
    count: number | null;
    since: string;
  }[];
  readonly channels: { readonly checkins: string; readonly devices: string };
}

/** Kiosk mode as the server handed it to this device (M3.4a). */
export interface KioskConfig {
  readonly eventId: string;
  readonly checkpointId: string | null;
  readonly pinHash: string;
  readonly startedAt: string;
}

/** What a heartbeat changed on this device. */
export interface HeartbeatOutcome {
  readonly wiped: boolean;
  /** A supervisor asked for a sync: done. */
  readonly synced: boolean;
  /** A supervisor moved the device: the new checkpoint (null = whole event). */
  readonly movedTo?: string | null;
  readonly kioskChanged: boolean;
}

/** Stop scanning with the downloaded list this long after the event ends (roadmap §5.4). */
const EXPIRY_MS = 24 * 3_600_000;
const BATCH = 500;

/**
 * The Scan PWA's engine: an offline-first manifest, a local admitted set and a scan queue that
 * flushes to `/api/v1/scans/batch` whenever the network allows. All verdicts come from the
 * shared `checkin-engine`; the server's answer (first-wins across devices) is final.
 */
export class ScanClient {
  private snapshot: Snapshot | null = null;
  private byId = new Map<string, ManifestRow>();
  private byShort = new Map<string, ManifestRow>();
  /** Migrated tickets by their legacy QR payload hashes (M1.9e). */
  private byLegacy = new Map<string, ManifestRow>();
  private admitted = new Set<string>();
  /** server time − device time, measured at each sync. */
  clockOffsetMs = 0;
  /** Where this device stands (an entrance or zone), or null for the whole event. */
  checkpointId: string | null = null;
  /** Kiosk mode (M3.4a), or null: set by a supervisor, left with the PIN. */
  kiosk: KioskConfig | null = null;

  constructor(readonly config: ScanConfig) {}

  get token(): string {
    return this.config.token;
  }

  static async stored(): Promise<ScanConfig | null> {
    return (await kvGet<ScanConfig>('config')) ?? null;
  }

  static async save(config: ScanConfig): Promise<void> {
    await kvSet('config', config);
  }

  private get api() {
    return {
      headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
    };
  }

  get ticketCount(): number {
    return this.byId.size;
  }

  get lastSyncAt(): Date | null {
    return this.snapshot ? new Date(this.snapshot.lastSyncAt) : null;
  }

  get eventName(): string | null {
    return this.snapshot?.header.event.name ?? null;
  }

  /** The live checkpoints this device may scan at (older snapshots have none). */
  get checkpoints(): ManifestHeader['checkpoints'] {
    return this.snapshot?.header.checkpoints ?? [];
  }

  /** True when the device is handed to checkpoint-scoped door staff (no "whole event"). */
  get scoped(): boolean {
    return (this.snapshot?.header.scope?.checkpointIds ?? null) !== null;
  }

  /** The chosen checkpoint, if it still exists; archived ones fall back to the whole event. */
  get checkpoint(): ManifestHeader['checkpoints'][number] | null {
    return this.checkpoints.find((c) => c.id === this.checkpointId) ?? null;
  }

  async setCheckpoint(id: string | null): Promise<void> {
    this.checkpointId = id;
    await kvSet('checkpointId', id);
  }

  /** Load the sealed snapshot. Returns false when it expired (the device is then wiped). */
  async load(): Promise<boolean> {
    const sealed = await kvGet<{ iv: Uint8Array; data: ArrayBuffer }>('manifest');
    if (sealed) {
      this.snapshot = await openJson<Snapshot>(this.config.token, sealed);
      this.index();
      if (Date.now() > new Date(this.snapshot.header.event.endsAt).getTime() + EXPIRY_MS) {
        await this.wipe();
        return false;
      }
    }
    // The admitted set is kept on its own (small, sealed): saving a scan never re-seals the list.
    const admitted = await kvGet<{ iv: Uint8Array; data: ArrayBuffer }>('admitted');
    if (admitted) this.admitted = new Set(await openJson<string[]>(this.config.token, admitted));
    this.clockOffsetMs = (await kvGet<number>('clockOffsetMs')) ?? 0;
    this.checkpointId = (await kvGet<string | null>('checkpointId')) ?? null;
    this.kiosk = (await kvGet<KioskConfig | null>('kiosk')) ?? null;
    return true;
  }

  private index() {
    const s = this.snapshot;
    this.byId = new Map((s?.rows ?? []).map((r) => [r.ticketId, r]));
    this.byShort = new Map((s?.rows ?? []).map((r) => [r.shortCode, r]));
    this.byLegacy = legacyIndex(s?.rows ?? []);
    this.admitted = new Set(s?.admitted ?? []);
  }

  private async persist() {
    if (!this.snapshot) return;
    this.snapshot.rows = [...this.byId.values()];
    this.snapshot.admitted = [...this.admitted];
    await kvSet('manifest', await sealJson(this.config.token, this.snapshot));
  }

  private async persistAdmitted() {
    await kvSet('admitted', await sealJson(this.config.token, [...this.admitted]));
  }

  /** Pull manifest changes since the last sync (first page overlaps a minute). */
  async sync(): Promise<void> {
    // A snapshot from an older manifest format is refetched from scratch (it has no signed scope);
    // until then it keeps working offline, and the server enforces the scope on sync.
    const current = (this.snapshot?.header.version ?? 1) >= MANIFEST_VERSION;
    let cursor = current ? (this.snapshot?.cursor ?? null) : null;
    if (!current) {
      this.byId = new Map();
      this.byShort = new Map();
      this.byLegacy = new Map();
    }
    let first = true;
    let header: ManifestHeader | null = null;
    for (;;) {
      const qs = new URLSearchParams({ limit: '2000' });
      if (cursor) qs.set('cursor', cursor);
      if (cursor && first) qs.set('overlap', 'true');
      const res = await fetch(`/api/v1/events/${this.config.eventId}/manifest?${qs}`, this.api);
      if (res.status === 403) throw new ScanSyncError('not_assigned');
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const page = (await res.json()) as {
        header: ManifestHeader;
        rows: ManifestRow[];
        cursor: string | null;
        complete: boolean;
      };
      header = page.header;
      for (const r of page.rows) {
        // A reissued (claimed) ticket gets a new short code: forget the old one, so it stops
        // working offline too.
        const prev = this.byId.get(r.ticketId);
        if (prev && prev.shortCode !== r.shortCode) this.byShort.delete(prev.shortCode);
        this.byId.set(r.ticketId, r);
        this.byShort.set(r.shortCode, r);
      }
      cursor = page.cursor;
      first = false;
      if (page.complete) break;
    }
    if (!header) return;
    // The scope is signed with the org's key: a manifest whose scope doesn't verify is not used.
    if (!(await verifyManifestScope(header))) throw new ScanSyncError('bad_scope');
    this.clockOffsetMs = new Date(header.serverTime).getTime() - Date.now();
    await kvSet('clockOffsetMs', this.clockOffsetMs);
    this.snapshot = {
      header,
      rows: [],
      cursor,
      lastSyncAt: header.serverTime,
      admitted: [...this.admitted],
    };
    this.byLegacy = legacyIndex(this.byId.values());
    await this.persist();
  }

  /** Decide locally (instant), record, queue; the flush that follows may refine it. */
  async scan(code: string): Promise<ScanOutcome> {
    if (!this.snapshot) throw new Error('No guest list yet — connect once to download it.');
    const now = new Date(Date.now() + this.clockOffsetMs);
    const { verdict, ticketId, row } = await offlineVerdict(
      {
        header: this.snapshot.header,
        byId: this.byId,
        byShortCode: this.byShort,
        byLegacyCode: this.byLegacy,
        admitted: this.admitted,
        lastSyncAt: new Date(this.snapshot.lastSyncAt),
      },
      code,
      now,
      this.checkpoint?.id ?? null,
    );
    if ((verdict === 'admit' || verdict === 'provisional') && ticketId) {
      this.admitted.add(admittedKey(ticketId, eventDay(now, this.snapshot.header.event.timezone)));
      await this.persistAdmitted();
    }
    const scan: QueuedScan = {
      scanId: uuidv7(),
      code: code.trim(),
      deviceTs: new Date().toISOString(),
      clockOffsetMs: this.clockOffsetMs,
      verdict,
      ...(this.checkpoint ? { checkpointId: this.checkpoint.id } : {}),
    };
    await queueAdd(scan);
    return {
      scanId: scan.scanId,
      verdict,
      holderName: row?.holderName ?? null,
      typeName: row?.typeName ?? null,
      server: null,
    };
  }

  async queueDepth(): Promise<number> {
    return (await queueAll()).length;
  }

  /**
   * Send queued scans; returns the server's result per scan id. Offline → throws, queue kept.
   * One flush at a time (the `online` event, a scan and the tick may ask together); each scan
   * leaves the queue only once the server has answered for it, and the server applies each
   * `scanId` once, so a flush cut off half-way is simply sent again.
   */
  readonly flush = singleFlight(async (): Promise<Map<string, ServerScan>> => {
    const out = new Map<string, ServerScan>();
    for (const batch of chunk(dedupeQueue(await queueAll()), BATCH)) {
      const res = await fetch('/api/v1/scans/batch', {
        method: 'POST',
        ...this.api,
        body: JSON.stringify({ eventId: this.config.eventId, scans: batch }),
      });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      const body = (await res.json()) as {
        results: { scanId: string; result: ServerResult; openSignals?: number }[];
      };
      for (const r of body.results) out.set(r.scanId, { result: r.result, openSignals: r.openSignals ?? 0 });
      await queueRemove(batch.map((c) => c.scanId));
    }
    return out;
  });

  /**
   * Health every 30 s (and when a supervisor pokes this device): reports where it works and
   * applies what the server hands back — wipe, a sync now, a new checkpoint, kiosk mode.
   */
  async heartbeat(batteryPct: number | null): Promise<HeartbeatOutcome> {
    const none = { wiped: false, synced: false, kioskChanged: false };
    const res = await fetch('/api/v1/devices/heartbeat', {
      method: 'POST',
      ...this.api,
      body: JSON.stringify({
        batteryPct,
        queueDepth: await this.queueDepth(),
        clockOffsetMs: this.clockOffsetMs,
        eventId: this.config.eventId,
        checkpointId: this.kiosk ? this.kiosk.checkpointId : (this.checkpoint?.id ?? null),
      }),
    });
    if (res.status === 401) {
      await this.wipe();
      return { ...none, wiped: true };
    }
    if (!res.ok) return none;
    const body = (await res.json()) as {
      commands: string[];
      syncRequestedAt?: string | null;
      checkpoint?: { id: string | null; requestedAt: string } | null;
      kiosk?: KioskConfig | null;
    };
    if (body.commands.includes('wipe')) {
      await this.wipe();
      return { ...none, wiped: true };
    }
    let synced = false;
    if (isNewDirective(body.syncRequestedAt, await kvGet<string>('appliedSyncAt'))) {
      await this.sync();
      await this.flush();
      await kvSet('appliedSyncAt', body.syncRequestedAt);
      synced = true;
    }
    let movedTo: string | null | undefined;
    if (
      body.checkpoint &&
      isNewDirective(body.checkpoint.requestedAt, await kvGet<string>('appliedCheckpointAt'))
    ) {
      // A checkpoint this device can't scan at (not in its manifest) falls back to the whole event.
      movedTo = this.checkpoints.some((c) => c.id === body.checkpoint?.id) ? body.checkpoint.id : null;
      await this.setCheckpoint(movedTo);
      await kvSet('appliedCheckpointAt', body.checkpoint.requestedAt);
    }
    // Kiosk: follow the server, except a session this device already left with the PIN (its exit
    // report is sent again until the server has it).
    const exited = await kvGet<string>('kioskExited');
    let next = body.kiosk ?? null;
    if (next && exited === next.startedAt) {
      await this.reportKioskExit(next.startedAt);
      next = null;
    }
    const kioskChanged = (next?.startedAt ?? null) !== (this.kiosk?.startedAt ?? null);
    if (kioskChanged) {
      this.kiosk = next;
      await kvSet('kiosk', next);
      if (next) await this.setCheckpoint(next.checkpointId);
    }
    return { wiped: false, synced, ...(movedTo !== undefined ? { movedTo } : {}), kioskChanged };
  }

  /** Leave kiosk mode after the PIN checked out on the device (works offline; reported later). */
  async leaveKiosk(): Promise<void> {
    const k = this.kiosk;
    if (!k) return;
    await kvSet('kioskExited', k.startedAt);
    this.kiosk = null;
    await kvSet('kiosk', null);
    await this.reportKioskExit(k.startedAt).catch(() => undefined);
  }

  private async reportKioskExit(startedAt: string): Promise<void> {
    const res = await fetch('/api/scan/kiosk/exit', {
      method: 'POST',
      ...this.api,
      body: JSON.stringify({ startedAt }),
    });
    if (!res.ok) throw new Error(`kiosk exit ${res.status}`);
  }

  /** Staff mode: counts, device board and alerts; kept for offline ("last updated"). */
  async staffOverview(): Promise<{ view: StaffView; fetchedAt: string; fresh: boolean } | null> {
    try {
      const res = await fetch(`/api/scan/staff?eventId=${encodeURIComponent(this.config.eventId)}`, this.api);
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`staff ${res.status}`);
      const saved = { view: (await res.json()) as StaffView, fetchedAt: new Date().toISOString() };
      await kvSet('staffOverview', saved);
      return { ...saved, fresh: true };
    } catch {
      const cached = await kvGet<{ view: StaffView; fetchedAt: string }>('staffOverview');
      return cached ? { ...cached, fresh: false } : null;
    }
  }

  async pushStatus(): Promise<{ subscribed: boolean; supervisor: boolean; endpoint: string | null } | null> {
    const res = await fetch('/api/scan/push', this.api);
    return res.ok
      ? ((await res.json()) as { subscribed: boolean; supervisor: boolean; endpoint: string | null })
      : null;
  }

  async subscribePush(body: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    locale: string;
    copy: Record<string, { title: string; body: string }>;
  }): Promise<string | null> {
    const res = await fetch('/api/scan/push', { method: 'POST', ...this.api, body: JSON.stringify(body) });
    if (res.ok) return null;
    return ((await res.json().catch(() => ({}))) as { code?: string }).code ?? 'internal';
  }

  async unsubscribePush(): Promise<boolean> {
    return (await fetch('/api/scan/push', { method: 'DELETE', ...this.api })).ok;
  }

  async wipe(): Promise<void> {
    this.snapshot = null;
    this.kiosk = null;
    this.index();
    await wipeAll();
  }
}
