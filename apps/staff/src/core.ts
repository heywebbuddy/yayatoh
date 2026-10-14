import { type Core, nativeAdapters, nativeIdentity, readAppExtra } from '@yayatoh/mobile-core';
import { batteryPercent } from './device/battery';
import type { DeviceSession } from './device/session';
import { catalogs } from './i18n';
import type { PortalSession } from './portal/session';
import { createStaffServices, type StaffServices } from './services';

let services: StaffServices | undefined;

/** Made on first use, so importing a screen in a test does not read the native build configuration. */
function app(): StaffServices {
  if (!services) {
    const extra = readAppExtra();
    const identity = nativeIdentity('staff');
    services = createStaffServices({
      apiBaseUrl: extra.apiBaseUrl,
      identity,
      catalogs,
      adapters: nativeAdapters('staff', identity.platform, extra),
      battery: batteryPercent,
      environment: extra.appEnv,
      ...(extra.sentryDsn ? { sentryDsn: extra.sentryDsn } : {}),
    });
  }
  return services;
}

/** The app's one `Core`: the person's session, the `/v1` client, the query cache, the version gate. */
export const getCore = (): Core => app().core;

/** The door device's session (M7.4a): the `yyd_` token in the keychain, the heartbeat, wipe. */
export const getDevice = (): DeviceSession => app().device;

/** The exhibitor rep's portal session (M7.4a), apart from an organizer's account session. */
export const getPortal = (): PortalSession => app().portal;
