/**
 * An encrypted JSON store for what the door tools keep on the phone (M7.4c): the guest list's
 * last answer, the guest check-in outbox and the lead outbox. Names, badge payloads and notes are
 * personal data, so each value is a file sealed with XChaCha20-Poly1305 (the same seal as the
 * query cache) under its own key in secure storage. `wipe()` deletes the key first, so the files
 * are unreadable even if removing one fails; a remote wipe (M7.4a `onWipe`) calls it.
 */
import {
  type FileStore,
  fromBase64,
  type KeyValueStore,
  openSealed,
  seal,
  toBase64,
} from '@yayatoh/mobile-core';

type RandomBytes = (length: number) => Uint8Array;

export const VAULT_KEY_NAME = 'yayatoh.staff-tools-key.v1';
const KEY_LENGTH = 32;

export interface Vault {
  read<T>(name: string): Promise<T | null>;
  write(name: string, value: unknown): Promise<void>;
  remove(name: string): Promise<void>;
  /** Deletes the key and every file this vault wrote. Safe to call twice. */
  wipe(): Promise<void>;
}

export function createVault(deps: {
  readonly storage: KeyValueStore;
  readonly files: FileStore;
  readonly random: RandomBytes;
}): Vault {
  const { storage, files, random } = deps;
  const written = new Set<string>();
  const fileOf = (name: string) => `yayatoh-tools-${name}.bin`;
  let cached: Uint8Array | null = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function key(create: boolean): Promise<Uint8Array | null> {
    if (cached) return cached;
    const stored = await storage.get(VAULT_KEY_NAME);
    if (stored) {
      try {
        const k = fromBase64(stored);
        if (k.length === KEY_LENGTH) return (cached = k);
      } catch {
        // A damaged key is as good as none.
      }
    }
    if (!create) return null;
    const k = random(KEY_LENGTH);
    await storage.set(VAULT_KEY_NAME, toBase64(k));
    return (cached = k);
  }

  return {
    async read<T>(name: string) {
      const file = await files.read(fileOf(name));
      if (!file) return null;
      const k = await key(false);
      const plain = k ? openSealed(file, k) : null;
      if (!plain) {
        await files.remove(fileOf(name));
        return null;
      }
      try {
        return JSON.parse(decoder.decode(plain)) as T;
      } catch {
        await files.remove(fileOf(name));
        return null;
      }
    },
    async write(name, value) {
      const k = await key(true);
      if (!k) return;
      written.add(name);
      await files.write(fileOf(name), seal(encoder.encode(JSON.stringify(value)), k, random));
    },
    async remove(name) {
      await files.remove(fileOf(name));
    },
    async wipe() {
      cached = null;
      await storage.delete(VAULT_KEY_NAME);
      for (const name of VAULT_FILES) await files.remove(fileOf(name)).catch(() => {});
      for (const name of written) await files.remove(fileOf(name)).catch(() => {});
    },
  };
}

/** Every file name the tools use, so a wipe after a restart still removes what an earlier run wrote. */
export const VAULT_FILES = ['guests', 'guest-outbox', 'lead-outbox', 'manual-log'] as const;
