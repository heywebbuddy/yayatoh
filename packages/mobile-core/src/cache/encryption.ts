/**
 * Encryption for the persisted query cache (M7.1c). Secure storage is too small for a cache (the
 * keychain holds little, and iOS warns above 2 KB per value), so the cache lives in a file and only
 * its key lives in secure storage.
 *
 * XChaCha20-Poly1305 (`@noble/ciphers`, plain JavaScript, so it runs on Hermes): a random 24-byte
 * nonce per write, the file header as associated data, and an authentication tag, so a file that was
 * edited, truncated or written under another key does not decrypt. Wiping deletes the key first:
 * once it is gone the file is unreadable even if deleting the file fails.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import type { KeyValueStore, RandomBytes } from '../ports';

export const CACHE_KEY_NAME = 'yayatoh.cache-key.v1';
const MAGIC = new TextEncoder().encode('YYC1');
const NONCE_LENGTH = 24;
const KEY_LENGTH = 32;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] ?? '';
    out += B64[(n >> 12) & 63] ?? '';
    out += i + 1 < bytes.length ? (B64[(n >> 6) & 63] ?? '') : '=';
    out += i + 2 < bytes.length ? (B64[n & 63] ?? '') : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('not base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** The cache key: 32 random bytes made on first use and kept in secure storage. */
export function createCacheKeyProvider(storage: KeyValueStore, random: RandomBytes) {
  let cached: Uint8Array | null = null;
  return {
    /** The key, or null when none exists (and `create` is false). */
    async get(create: boolean): Promise<Uint8Array | null> {
      if (cached) return cached;
      const stored = await storage.get(CACHE_KEY_NAME);
      if (stored) {
        try {
          const key = fromBase64(stored);
          if (key.length === KEY_LENGTH) {
            cached = key;
            return key;
          }
        } catch {
          // A damaged key is as good as none.
        }
      }
      if (!create) return null;
      const key = random(KEY_LENGTH);
      await storage.set(CACHE_KEY_NAME, toBase64(key));
      cached = key;
      return key;
    },
    /** Forgets the key: what it encrypted can no longer be read. */
    async destroy(): Promise<void> {
      cached = null;
      await storage.delete(CACHE_KEY_NAME);
    },
  };
}

export type CacheKeyProvider = ReturnType<typeof createCacheKeyProvider>;

/** `YYC1 | nonce(24) | ciphertext+tag`. */
export function seal(plain: Uint8Array, key: Uint8Array, random: RandomBytes): Uint8Array {
  const nonce = random(NONCE_LENGTH);
  const sealed = xchacha20poly1305(key, nonce, MAGIC).encrypt(plain);
  const out = new Uint8Array(MAGIC.length + NONCE_LENGTH + sealed.length);
  out.set(MAGIC, 0);
  out.set(nonce, MAGIC.length);
  out.set(sealed, MAGIC.length + NONCE_LENGTH);
  return out;
}

/** The plain bytes, or null when the file is not ours, is damaged or was sealed with another key. */
export function open(file: Uint8Array, key: Uint8Array): Uint8Array | null {
  if (file.length < MAGIC.length + NONCE_LENGTH + 16) return null;
  for (let i = 0; i < MAGIC.length; i++) if (file[i] !== MAGIC[i]) return null;
  try {
    const nonce = file.subarray(MAGIC.length, MAGIC.length + NONCE_LENGTH);
    return xchacha20poly1305(key, nonce, MAGIC).decrypt(file.subarray(MAGIC.length + NONCE_LENGTH));
  } catch {
    return null;
  }
}
