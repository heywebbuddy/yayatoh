import { type Core, createCore, nativeAdapters, nativeIdentity, readAppExtra } from '@yayatoh/mobile-core';
import { catalogs } from './i18n';

let core: Core | undefined;

/**
 * The app's one `Core` (session, `/v1` client, query cache, version gate), made on first use so
 * importing a screen in a test does not read the native build configuration.
 */
export function getCore(): Core {
  if (!core) {
    const extra = readAppExtra();
    const identity = nativeIdentity('mobile');
    core = createCore({
      appName: 'Yayatoh',
      identity,
      apiBaseUrl: extra.apiBaseUrl,
      catalogs,
      adapters: nativeAdapters('mobile', identity.platform, extra),
      environment: extra.appEnv,
      ...(extra.sentryDsn ? { sentryDsn: extra.sentryDsn } : {}),
    });
  }
  return core;
}
