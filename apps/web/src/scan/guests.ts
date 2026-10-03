import { GUEST_SNAPSHOT_VERSION, type GuestSnapshot, type SnapshotGuest } from '@yayatoh/checkin-engine';
import { uuidv7 } from '@yayatoh/kernel';
import { kvGet, kvSet, openJson, sealJson } from './store.ts';
import { chunk, singleFlight } from './sync-queue.ts';

/** A guest check-in waiting to reach the server (M4.4b). */
export interface QueuedArrival {
  readonly clientId: string;
  readonly guestId: string;
  readonly deviceTs: string;
  readonly clockOffsetMs: number;
  readonly source: 'scanner' | 'kiosk';
}

export type ArrivalResult = 'arrived' | 'already' | 'unknown';

const BATCH = 500;

/**
 * Guest check-in on a Scan PWA device (M4.4b): the event's guest snapshot (names, party labels,
 * tables; sealed like the ticket manifest), the arrivals recorded here and a queue that syncs them
 * when the network allows. Everything works offline from the last snapshot: staff check-in by name
 * or party, the guest kiosk and the A–Z board.
 */
export class GuestBook {
  private snapshot: GuestSnapshot | null = null;
  /** Arrivals recorded on this device (guest id → ISO time), kept until a snapshot includes them. */
  private local = new Map<string, string>();
  private queue: QueuedArrival[] = [];

  constructor(
    private readonly eventId: string,
    private readonly token: string,
  ) {}

  private get headers() {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' };
  }

  async load(): Promise<void> {
    const sealed = await kvGet<{ iv: Uint8Array; data: ArrayBuffer }>('guests');
    if (sealed) this.snapshot = await openJson<GuestSnapshot>(this.token, sealed);
    this.queue = (await kvGet<QueuedArrival[]>('guestQueue')) ?? [];
    this.local = new Map(Object.entries((await kvGet<Record<string, string>>('guestLocal')) ?? {}));
  }

  /** Whether this event has guests (a wedding or gala guest list) on the device. */
  get available(): boolean {
    return (this.snapshot?.parties.length ?? 0) > 0;
  }

  get queued(): number {
    return this.queue.length;
  }

  /** The snapshot with this device's own arrivals folded in. */
  view(): GuestSnapshot | null {
    const s = this.snapshot;
    if (!s) return null;
    if (this.local.size === 0) return s;
    return {
      ...s,
      parties: s.parties.map((p) => ({
        ...p,
        guests: p.guests.map((g) =>
          g.arrivedAt || !this.local.has(g.id) ? g : { ...g, arrivedAt: this.local.get(g.id) ?? null },
        ),
      })),
    };
  }

  guest(id: string): SnapshotGuest | null {
    for (const p of this.view()?.parties ?? []) for (const g of p.guests) if (g.id === id) return g;
    return null;
  }

  /** Download the snapshot; a server that has no guest list for the event leaves it empty. */
  async sync(): Promise<void> {
    const res = await fetch(`/api/scan/guests?eventId=${encodeURIComponent(this.eventId)}`, {
      headers: this.headers,
    });
    if (res.status === 404 || res.status === 403) return;
    if (!res.ok) throw new Error(`guests ${res.status}`);
    const snap = (await res.json()) as GuestSnapshot;
    if (snap.version !== GUEST_SNAPSHOT_VERSION || snap.eventId !== this.eventId) return;
    this.snapshot = snap;
    // Arrivals the server knows now (or that were undone and not queued here) leave the local set.
    const queued = new Set(this.queue.map((q) => q.guestId));
    for (const id of [...this.local.keys()]) if (!queued.has(id)) this.local.delete(id);
    await kvSet('guests', await sealJson(this.token, snap));
    await this.saveLocal();
  }

  private async saveLocal() {
    await kvSet('guestLocal', Object.fromEntries(this.local));
    await kvSet('guestQueue', this.queue);
  }

  /**
   * Check a guest in on this device (instant, offline too) and queue it. Returns false when the
   * guest had already arrived (here or by the last snapshot).
   */
  async checkIn(guestId: string, source: 'scanner' | 'kiosk', clockOffsetMs: number): Promise<boolean> {
    const g = this.guest(guestId);
    if (!g || g.arrivedAt) return false;
    const now = new Date();
    this.local.set(guestId, new Date(now.getTime() + clockOffsetMs).toISOString());
    this.queue.push({ clientId: uuidv7(), guestId, deviceTs: now.toISOString(), clockOffsetMs, source });
    await this.saveLocal();
    return true;
  }

  /** Send queued arrivals; offline → throws and keeps the queue. One flush at a time. */
  readonly flush = singleFlight(async (): Promise<Map<string, ArrivalResult>> => {
    const out = new Map<string, ArrivalResult>();
    for (const batch of chunk([...this.queue], BATCH)) {
      const res = await fetch('/api/scan/guests', {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ eventId: this.eventId, arrivals: batch }),
      });
      if (!res.ok) throw new Error(`guest sync ${res.status}`);
      const body = (await res.json()) as { results: { clientId: string; result: ArrivalResult }[] };
      for (const r of body.results) out.set(r.clientId, r.result);
      const sent = new Set(batch.map((b) => b.clientId));
      this.queue = this.queue.filter((q) => !sent.has(q.clientId));
      await this.saveLocal();
    }
    return out;
  });
}
