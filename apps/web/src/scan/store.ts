/**
 * The Scan PWA's local store: one IndexedDB database with a key/value store (config, manifest,
 * admitted set) and the scan queue. The manifest is AES-GCM encrypted with a key derived from
 * the device token — obfuscation only, as roadmap §5.4 says a PWA cannot do better.
 */
const DB = 'yy-scan';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'scanId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
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

export const kvGet = <T>(key: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key: string, value: unknown) => run('kv', 'readwrite', (s) => s.put(value, key));

export interface QueuedScan {
  readonly scanId: string;
  readonly code: string;
  readonly deviceTs: string;
  readonly clockOffsetMs: number;
  readonly verdict: string;
  readonly checkpointId?: string;
}

export const queueAdd = (scan: QueuedScan) => run('queue', 'readwrite', (s) => s.put(scan));
export const queueAll = () => run<QueuedScan[]>('queue', 'readonly', (s) => s.getAll());
export const queueRemove = (ids: readonly string[]) =>
  run('queue', 'readwrite', (s) => {
    let last: IDBRequest = s.count();
    for (const id of ids) last = s.delete(id);
    return last;
  });

/** Remote wipe or expiry: drop everything, including the device key. */
export function wipeAll(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

async function keyFor(token: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`yy-scan:${token}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealJson(
  token: string,
  value: unknown,
): Promise<{ iv: Uint8Array; data: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await keyFor(token),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return { iv, data };
}

export async function openJson<T>(token: string, sealed: { iv: Uint8Array; data: ArrayBuffer }): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(sealed.iv) },
    await keyFor(token),
    sealed.data,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
