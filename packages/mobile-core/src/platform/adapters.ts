import type { MobileApp, MobilePlatform } from '../client';
import type { CoreAdapters } from '../core';
import { expoAppleProvider, expoGoogleProvider } from '../session/providers';
import { type AppExtra, googleOptions } from './native';
import { documentFileStore, secureKeyValueStore, secureRandomBytes } from './stores';

/** The real adapters: keychain, document files, secure random, Apple and (if configured) Google. */
export function nativeAdapters(app: MobileApp, platform: MobilePlatform, extra: AppExtra): CoreAdapters {
  const google = googleOptions(extra, platform);
  return {
    storage: secureKeyValueStore(app === 'staff' ? 'yayatoh-staff' : 'yayatoh'),
    files: documentFileStore(),
    random: secureRandomBytes,
    ...(platform === 'ios' && app === 'mobile' ? { apple: expoAppleProvider() } : {}),
    ...(google ? { google: expoGoogleProvider(google) } : {}),
  };
}
