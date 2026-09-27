import {
  admittedKey,
  eventDay,
  type ManifestHeader,
  type ManifestRow,
  type OfflineVerdict,
  offlineVerdict,
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
  | 'outside_window'
  | 'duplicate_offline'
  | 'superseded'
  | 'provisional';

export interface ScanOutcome {
  readonly scanId: string;
  readonly verdict: OfflineVerdict;
  readonly holderName: string | null;
  readonly typeName: string | null;
  /** Set once the server has reconciled this scan (it may disagree with the local verdict). */
  readonly server: ServerResult | null;
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
  private admitted = new Set<string>();
  /** server time − device time, measured at each sync. */
  clockOffsetMs = 0;

  constructor(readonly config: ScanConfig) {}

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
    this.clockOffsetMs = (await kvGet<number>('clockOffsetMs')) ?? 0;
    return true;
  }

  private index() {
    const s = this.snapshot;
    this.byId = new Map((s?.rows ?? []).map((r) => [r.ticketId, r]));
    this.byShort = new Map((s?.rows ?? []).map((r) => [r.shortCode, r]));
    this.admitted = new Set(s?.admitted ?? []);
  }

  private async persist() {
    if (!this.snapshot) return;
    this.snapshot.rows = [...this.byId.values()];
    this.snapshot.admitted = [...this.admitted];
    await kvSet('manifest', await sealJson(this.config.token, this.snapshot));
  }

  /** Pull manifest changes since the last sync (first page overlaps a minute). */
  async sync(): Promise<void> {
    let cursor = this.snapshot?.cursor ?? null;
    let first = true;
    let header: ManifestHeader | null = null;
    for (;;) {
      const qs = new URLSearchParams({ limit: '2000' });
      if (cursor) qs.set('cursor', cursor);
      if (cursor && first) qs.set('overlap', 'true');
      const res = await fetch(`/api/v1/events/${this.config.eventId}/manifest?${qs}`, this.api);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const page = (await res.json()) as {
        header: ManifestHeader;
        rows: ManifestRow[];
        cursor: string | null;
        complete: boolean;
      };
      header = page.header;
      for (const r of page.rows) {
        this.byId.set(r.ticketId, r);
        this.byShort.set(r.shortCode, r);
      }
      cursor = page.cursor;
      first = false;
      if (page.complete) break;
    }
    if (!header) return;
    this.clockOffsetMs = new Date(header.serverTime).getTime() - Date.now();
    await kvSet('clockOffsetMs', this.clockOffsetMs);
    this.snapshot = {
      header,
      rows: [],
      cursor,
      lastSyncAt: header.serverTime,
      admitted: [...this.admitted],
    };
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
        admitted: this.admitted,
        lastSyncAt: new Date(this.snapshot.lastSyncAt),
      },
      code,
      now,
    );
    if ((verdict === 'admit' || verdict === 'provisional') && ticketId) {
      this.admitted.add(admittedKey(ticketId, eventDay(now, this.snapshot.header.event.timezone)));
      await this.persist();
    }
    const scan: QueuedScan = {
      scanId: uuidv7(),
      code: code.trim(),
      deviceTs: new Date().toISOString(),
      clockOffsetMs: this.clockOffsetMs,
      verdict,
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

  /** Send queued scans; returns the server's result per scan id. Offline → throws, queue kept. */
  async flush(): Promise<Map<string, ServerResult>> {
    const out = new Map<string, ServerResult>();
    const queued = await queueAll();
    for (let i = 0; i < queued.length; i += BATCH) {
      const chunk = queued.slice(i, i + BATCH);
      const res = await fetch('/api/v1/scans/batch', {
        method: 'POST',
        ...this.api,
        body: JSON.stringify({ eventId: this.config.eventId, scans: chunk }),
      });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      const body = (await res.json()) as { results: { scanId: string; result: ServerResult }[] };
      for (const r of body.results) out.set(r.scanId, r.result);
      await queueRemove(chunk.map((c) => c.scanId));
    }
    return out;
  }

  /** Health every 30 s. Returns true when the server asked for a wipe (already done). */
  async heartbeat(batteryPct: number | null): Promise<boolean> {
    const res = await fetch('/api/v1/devices/heartbeat', {
      method: 'POST',
      ...this.api,
      body: JSON.stringify({
        batteryPct,
        queueDepth: await this.queueDepth(),
        clockOffsetMs: this.clockOffsetMs,
      }),
    });
    if (res.status === 401) {
      await this.wipe();
      return true;
    }
    if (!res.ok) return false;
    const body = (await res.json()) as { commands: string[] };
    if (body.commands.includes('wipe')) {
      await this.wipe();
      return true;
    }
    return false;
  }

  async wipe(): Promise<void> {
    this.snapshot = null;
    this.index();
    await wipeAll();
  }
}
