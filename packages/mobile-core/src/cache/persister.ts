/**
 * The TanStack Query persister (M7.1c): the whole dehydrated cache as one encrypted file.
 *
 * What is persisted is what was fetched while signed in (the person's tickets, orders, events), so
 * sign-out destroys the key and the file (`wipe`). A file that cannot be decrypted (no key, a
 * different key, tampering) is treated as an empty cache and removed.
 */
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import type { FileStore, RandomBytes } from '../ports';
import { type CacheKeyProvider, open, seal } from './encryption';

export const CACHE_FILE = 'yayatoh-query-cache.bin';

export interface EncryptedPersister extends Persister {
  /** Deletes the key and the file. Safe to call twice. */
  wipe(): Promise<void>;
}

export function createEncryptedPersister(deps: {
  readonly files: FileStore;
  readonly keys: CacheKeyProvider;
  readonly random: RandomBytes;
  readonly fileName?: string;
}): EncryptedPersister {
  const name = deps.fileName ?? CACHE_FILE;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    async persistClient(client: PersistedClient) {
      const key = await deps.keys.get(true);
      if (!key) return;
      await deps.files.write(name, seal(encoder.encode(JSON.stringify(client)), key, deps.random));
    },
    async restoreClient() {
      const file = await deps.files.read(name);
      if (!file) return undefined;
      const key = await deps.keys.get(false);
      const plain = key ? open(file, key) : null;
      if (!plain) {
        await deps.files.remove(name);
        return undefined;
      }
      try {
        return JSON.parse(decoder.decode(plain)) as PersistedClient;
      } catch {
        await deps.files.remove(name);
        return undefined;
      }
    },
    async removeClient() {
      await deps.files.remove(name);
    },
    async wipe() {
      // Key first: if deleting the file fails, what is left is unreadable.
      await deps.keys.destroy();
      await deps.files.remove(name);
    },
  };
}
