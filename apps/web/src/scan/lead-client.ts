import { uuidv7 } from '@yayatoh/kernel';
import { SYNC_BATCH_MAX } from '@yayatoh/leads/rules';
import {
  type LeadView,
  mergeLeads,
  pendingBatches,
  type QueuedLeadScan,
  type ScanResultView,
  withEdits,
} from './lead-queue.ts';
import { singleFlight } from './sync-queue.ts';

/**
 * The Scan PWA's lead mode (M5.6b): one IndexedDB database per browser (`yy-leads`) with the
 * person's last setup and visible leads (for offline use) and the scan queue. The person is the
 * portal session (cookie); a signed-out answer wipes the database, so a shared device keeps no
 * one's leads. Scans are queued first and sent in batches; the server applies each scan id once.
 */
const DB = 'yy-leads';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'scanId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const kvGet = <T>(key: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(key));
const kvSet = (key: string, value: unknown) => run('kv', 'readwrite', (s) => s.put(value, key));
const queueAll = () => run<QueuedLeadScan[]>('queue', 'readonly', (s) => s.getAll());
const queuePut = (scan: QueuedLeadScan) => run('queue', 'readwrite', (s) => s.put(scan));
const queueGet = (id: string) => run<QueuedLeadScan | undefined>('queue', 'readonly', (s) => s.get(id));
const queueRemove = (ids: readonly string[]) =>
  run('queue', 'readwrite', (s) => {
    let last: IDBRequest = s.count();
    for (const id of ids) last = s.delete(id);
    return last;
  });

function wipe(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export interface LeadSetup {
  readonly eventName: string;
  readonly timezone: string;
  readonly exhibitorName: string;
  readonly role: 'exhibitor_admin' | 'exhibitor_staff';
  readonly email: string;
  readonly license: 'licensed' | 'unlicensed' | 'over_allowance';
  readonly termsAccepted: boolean;
  readonly capture: {
    readonly state: 'not_open' | 'open' | 'closed';
    readonly opensAt: string;
    readonly closesAt: string;
    readonly accessUntil: string;
    readonly accessOpen: boolean;
  };
  readonly qualifiers: readonly string[];
  readonly teamVisibility: boolean;
}

interface Saved {
  setup: LeadSetup;
  leads: LeadView[];
  scope: 'all' | 'team' | 'own';
  savedAt: string;
}

/** Nobody is signed in on this host (or the person is no longer an exhibitor's). */
export class LeadSignedOut extends Error {}
/** The network is down (the queue waits). */
export class LeadOffline extends Error {}
/** The server refused the request for a reason the screen explains. */
export class LeadRefused extends Error {
  constructor(
    readonly code: string,
    readonly reason: string | null,
  ) {
    super(code);
  }
}

async function call(url: string, init: RequestInit, locale: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), 'x-yy-locale': locale },
    });
  } catch {
    throw new LeadOffline('offline');
  }
  if (res.status === 401) throw new LeadSignedOut('signed out');
  const body = (await res.json().catch(() => null)) as {
    code?: string;
    details?: { reason?: string };
  } | null;
  if (!res.ok) {
    if (res.status >= 500 && !body?.code) throw new LeadOffline('server');
    throw new LeadRefused(body?.code ?? 'internal', body?.details?.reason ?? null);
  }
  return body;
}

export class LeadClient {
  setup: LeadSetup | null = null;
  leads: LeadView[] = [];
  scope: Saved['scope'] = 'own';
  savedAt: Date | null = null;

  constructor(readonly locale: string) {}

  /** The last answer this device kept (for offline use). */
  async load(): Promise<void> {
    const saved = await kvGet<Saved>('state');
    if (!saved) return;
    this.setup = saved.setup;
    this.leads = saved.leads;
    this.scope = saved.scope;
    this.savedAt = new Date(saved.savedAt);
  }

  private async save() {
    if (!this.setup) return;
    this.savedAt = new Date();
    await kvSet('state', {
      setup: this.setup,
      leads: this.leads,
      scope: this.scope,
      savedAt: this.savedAt.toISOString(),
    } satisfies Saved);
  }

  /** Fetch the setup and the leads; signed out wipes this device's lead data. */
  async refresh(): Promise<void> {
    try {
      const r = (await call('/api/scan/leads', { method: 'GET' }, this.locale)) as Omit<Saved, 'savedAt'>;
      this.setup = r.setup;
      this.leads = r.leads;
      this.scope = r.scope;
      await this.save();
    } catch (err) {
      if (err instanceof LeadSignedOut) await this.signOut();
      throw err;
    }
  }

  async signOut(): Promise<void> {
    this.setup = null;
    this.leads = [];
    await wipe();
  }

  queue = () => queueAll();

  /** Queue a scan (its result comes with the next sync). */
  async scan(code: string, online: boolean): Promise<QueuedLeadScan> {
    const s: QueuedLeadScan = {
      scanId: uuidv7(),
      code: code.trim(),
      capturedAt: new Date().toISOString(),
      offline: !online,
    };
    await queuePut(s);
    return s;
  }

  /** Rate, qualify or annotate a scan still waiting to sync: the edits go with it. */
  async editQueued(scanId: string, edits: Pick<QueuedLeadScan, 'rating' | 'qualifiers' | 'notes'>) {
    const s = await queueGet(scanId);
    if (!s) return false;
    await queuePut(withEdits(s, edits));
    return true;
  }

  /** Send the queue; answered scans leave it. Returns each answered scan's result. */
  flush = singleFlight(async (): Promise<Map<string, ScanResultView>> => {
    const out = new Map<string, ScanResultView>();
    for (const batch of pendingBatches(await queueAll(), SYNC_BATCH_MAX)) {
      let r: { results: ScanResultView[] };
      try {
        r = (await call(
          '/api/scan/leads',
          { method: 'POST', body: JSON.stringify({ scans: batch }) },
          this.locale,
        )) as {
          results: ScanResultView[];
        };
      } catch (err) {
        if (err instanceof LeadSignedOut) await this.signOut();
        throw err;
      }
      for (const x of r.results) out.set(x.scanId, x);
      this.leads = mergeLeads(this.leads, r.results);
      await queueRemove(r.results.map((x) => x.scanId));
      await this.save();
    }
    return out;
  });

  /** Save a synced lead's rating, qualifiers and notes (online). */
  async update(
    leadId: string,
    edits: { rating: LeadView['rating']; qualifiers: readonly string[]; notes: string },
  ): Promise<void> {
    await call(`/api/scan/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(edits) }, this.locale);
    this.leads = this.leads.map((l) => (l.id === leadId ? { ...l, ...edits } : l));
    await this.save();
  }
}
