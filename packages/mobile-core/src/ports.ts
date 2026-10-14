/**
 * The seams between mobile-core and the phone (M7.1c). Everything that touches native storage or a
 * platform sheet sits behind one of these small interfaces, with an Expo adapter for the app and an
 * in-memory fake for tests, so the logic around them (refresh, wipe, encryption) runs under Jest
 * without a device.
 */

/** Small string values by key. The Expo adapter is `expo-secure-store` (keychain / keystore). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Whole files by name, in the app's private storage. */
export interface FileStore {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

/** Fills a buffer with cryptographically secure random bytes (`expo-crypto` on a phone). */
export type RandomBytes = (length: number) => Uint8Array;

/** An in-memory `KeyValueStore`, for tests and for previews that must not touch the keychain. */
export function memoryKeyValueStore(initial: Record<string, string> = {}): KeyValueStore & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
  };
}

/** An in-memory `FileStore`, for tests. */
export function memoryFileStore(): FileStore & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    read: async (name) => files.get(name) ?? null,
    write: async (name, bytes) => void files.set(name, bytes.slice()),
    remove: async (name) => void files.delete(name),
  };
}
