import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import { YayatohApiError } from '@yayatoh/sdk';
import { randomBytes } from 'node:crypto';
import {
  CACHE_KEY_NAME,
  createCacheKeyProvider,
  fromBase64,
  open,
  seal,
  toBase64,
} from '../src/cache/encryption';
import { CACHE_FILE, createEncryptedPersister } from '../src/cache/persister';
import { clearServerState, createAppQueryClient, persistOptions, shouldRetry } from '../src/cache/query-client';
import { type FileStore, memoryKeyValueStore } from '../src/ports';

const random = (n: number) => new Uint8Array(randomBytes(n));

/** A real directory on disk, so the tests read the same bytes a person with the phone's files would. */
function diskFiles(dir: string): FileStore {
  return {
    read: async (name) => {
      try {
        return new Uint8Array(readFileSync(join(dir, name)));
      } catch {
        return null;
      }
    },
    write: async (name, bytes) => writeFileSync(join(dir, name), bytes),
    remove: async (name) => rmSync(join(dir, name), { force: true }),
  };
}

const SECRET = 'Ada Lovelace — VIP ticket QR yyt_SECRET_CODE_12345';
const snapshot = (): PersistedClient => ({
  timestamp: Date.now(),
  buster: 'b1',
  clientState: {
    mutations: [],
    queries: [
      {
        queryKey: ['tickets'],
        queryHash: '["tickets"]',
        state: { data: [{ holder: SECRET }], dataUpdateCount: 1, dataUpdatedAt: 1, error: null, errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: 'success', fetchStatus: 'idle' },
      },
    ],
  },
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yy-cache-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function build() {
  const files = diskFiles(dir);
  const secure = memoryKeyValueStore();
  const keys = createCacheKeyProvider(secure, random);
  const persister = createEncryptedPersister({ files, keys, random });
  return { files, secure, keys, persister };
}

describe('base64', () => {
  it('round-trips every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = random(n);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
  });
  it('matches the standard encoding', () => {
    expect(toBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
    expect(toBase64(new TextEncoder().encode('Ma'))).toBe('TWE=');
    expect(toBase64(new TextEncoder().encode('M'))).toBe('TQ==');
  });
});

describe('seal / open', () => {
  const key = random(32);
  it('round-trips and uses a new nonce each time', () => {
    const plain = new TextEncoder().encode('hello');
    const a = seal(plain, key, random);
    const b = seal(plain, key, random);
    expect(open(a, key)).toEqual(plain);
    expect(a).not.toEqual(b);
  });
  it('refuses another key, a flipped byte, a truncated file and a file that is not ours', () => {
    const sealed = seal(new TextEncoder().encode('hello'), key, random);
    expect(open(sealed, random(32))).toBeNull();
    const flipped = sealed.slice();
    flipped[flipped.length - 1] ^= 1;
    expect(open(flipped, key)).toBeNull();
    expect(open(sealed.subarray(0, 20), key)).toBeNull();
    expect(open(new TextEncoder().encode('{"plain":"json"}'.repeat(5)), key)).toBeNull();
    const header = sealed.slice();
    header[0] ^= 1;
    expect(open(header, key)).toBeNull();
  });
});

describe('encrypted persister', () => {
  it('stores and restores the cache', async () => {
    const { persister } = build();
    await persister.persistClient(snapshot());
    const restored = await persister.restoreClient();
    expect(restored?.clientState.queries[0]?.state.data).toEqual([{ holder: SECRET }]);
  });

  it('the file on disk is unreadable without the key: no plaintext, no JSON, and it will not open', async () => {
    const { persister, secure } = build();
    await persister.persistClient(snapshot());
    const raw = readFileSync(join(dir, CACHE_FILE));
    const text = raw.toString('latin1');
    for (const needle of ['Ada', 'Lovelace', 'yyt_', 'tickets', 'queryKey', 'holder']) {
      expect(text).not.toContain(needle);
    }
    expect(() => JSON.parse(raw.toString('utf8'))).toThrow();
    // With the wrong key nothing comes out…
    expect(open(new Uint8Array(raw), random(32))).toBeNull();
    // …and with the right one it does (the key is only in secure storage).
    const key = fromBase64(secure.data.get(CACHE_KEY_NAME) ?? '');
    expect(key.length).toBe(32);
    expect(JSON.parse(new TextDecoder().decode(open(new Uint8Array(raw), key) ?? new Uint8Array()))).toMatchObject({ buster: 'b1' });
  });

  it('a lost key makes the cache empty (and removes the dead file) rather than failing', async () => {
    const { persister, secure, files } = build();
    await persister.persistClient(snapshot());
    secure.data.delete(CACHE_KEY_NAME);
    const fresh = createEncryptedPersister({ files, keys: createCacheKeyProvider(secure, random), random });
    expect(await fresh.restoreClient()).toBeUndefined();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a tampered file restores as empty', async () => {
    const { persister } = build();
    await persister.persistClient(snapshot());
    const path = join(dir, CACHE_FILE);
    const bytes = readFileSync(path);
    bytes[bytes.length - 3] ^= 0xff;
    writeFileSync(path, bytes);
    expect(await persister.restoreClient()).toBeUndefined();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('wipe destroys the key and the file, so even a copied file stays unreadable', async () => {
    const { persister, secure } = build();
    await persister.persistClient(snapshot());
    const copy = new Uint8Array(readFileSync(join(dir, CACHE_FILE)));
    const keyBefore = fromBase64(secure.data.get(CACHE_KEY_NAME) ?? '');
    await persister.wipe();
    expect(readdirSync(dir)).toEqual([]);
    expect(secure.data.has(CACHE_KEY_NAME)).toBe(false);
    expect(open(copy, keyBefore)).not.toBeNull(); // sanity: it was valid with the old key
    // A new session gets a new key: the copy never opens again.
    await persister.persistClient(snapshot());
    const keyAfter = fromBase64(secure.data.get(CACHE_KEY_NAME) ?? '');
    expect(keyAfter).not.toEqual(keyBefore);
    expect(open(copy, keyAfter)).toBeNull();
    await persister.wipe();
    await persister.wipe(); // twice is fine
  });

  it('restoring with no file is undefined', async () => {
    expect(await build().persister.restoreClient()).toBeUndefined();
  });
});

describe('query client', () => {
  it('clearServerState empties memory, the file and the key', async () => {
    const { persister, secure } = build();
    const client = createAppQueryClient();
    client.setQueryData(['tickets'], [{ holder: SECRET }]);
    await persister.persistClient(snapshot());
    await clearServerState(client, persister);
    expect(client.getQueryData(['tickets'])).toBeUndefined();
    expect(readdirSync(dir)).toEqual([]);
    expect(secure.data.size).toBe(0);
  });

  it('retries transient failures only', () => {
    const problem = (status: number) => new YayatohApiError(new Response(null, { status }), null);
    expect(shouldRetry(0, new TypeError('Network request failed'))).toBe(true);
    expect(shouldRetry(0, problem(503))).toBe(true);
    expect(shouldRetry(0, problem(429))).toBe(true);
    for (const s of [400, 401, 403, 404, 426]) expect(shouldRetry(0, problem(s))).toBe(false);
    expect(shouldRetry(3, new TypeError('x'))).toBe(false);
  });

  it('keeps data at least as long as it persists it', () => {
    const client = createAppQueryClient();
    const gc = client.getDefaultOptions().queries?.gcTime ?? 0;
    expect(gc).toBeGreaterThanOrEqual(persistOptions(build().persister, 'x').maxAge);
  });

  it('persists only successful queries that did not opt out', () => {
    const { dehydrateOptions } = persistOptions(build().persister, '1.0.0');
    const should = dehydrateOptions.shouldDehydrateQuery;
    expect(should({ state: { status: 'success' } })).toBe(true);
    expect(should({ state: { status: 'error' } })).toBe(false);
    expect(should({ state: { status: 'success' }, meta: { persist: false } })).toBe(false);
  });

  it('is a plain QueryClient', () => {
    expect(createAppQueryClient()).toBeInstanceOf(QueryClient);
  });
});
