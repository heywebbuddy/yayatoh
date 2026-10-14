/**
 * The Expo adapters for the ports: the keychain / keystore through `expo-secure-store`, files in
 * the app's private document directory through `expo-file-system`, and random bytes from
 * `expo-crypto`. The only place mobile-core touches those three modules.
 */
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { FileStore, KeyValueStore, RandomBytes } from '../ports';

/**
 * Secure storage for tokens and keys. `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: usable by a push
 * handler while the phone is locked, never restored onto another phone from a backup.
 */
export function secureKeyValueStore(service = 'yayatoh'): KeyValueStore {
  const options: SecureStore.SecureStoreOptions = {
    keychainService: service,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  };
  return {
    get: (key) => SecureStore.getItemAsync(key, options),
    set: (key, value) => SecureStore.setItemAsync(key, value, options),
    delete: (key) => SecureStore.deleteItemAsync(key, options),
  };
}

/** Files under the app's document directory (private to the app; the contents are encrypted). */
export function documentFileStore(): FileStore {
  const fileOf = (name: string) => new File(Paths.document, name);
  return {
    async read(name) {
      const file = fileOf(name);
      return file.exists ? await file.bytes() : null;
    },
    async write(name, bytes) {
      const file = fileOf(name);
      if (!file.exists) file.create({ intermediates: true });
      file.write(bytes);
    },
    async remove(name) {
      const file = fileOf(name);
      if (file.exists) file.delete();
    },
  };
}

export const secureRandomBytes: RandomBytes = (length) => Crypto.getRandomBytes(length);
