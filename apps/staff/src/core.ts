import { type Core, createCore, nativeAdapters, nativeIdentity, readAppExtra } from '@yayatoh/mobile-core';
import { batteryPercent } from './device/battery';
import { createDeviceSession, type DeviceSession } from './device/session';
import { catalogs } from './i18n';
import { createPortalSession, type PortalSession } from './portal/session';

let core: Core | undefined;
let device: DeviceSession | undefined;
let portal: PortalSession | undefined;

/**
 * The app's one `Core` (session, `/v1` client, query cache, version gate), made on first use so
 * importing a screen in a test does not read the native build configuration.
 */
export function getCore(): Core {
  if (!core) {
    const extra = readAppExtra();
    const identity = nativeIdentity('staff');
    core = createCore({
      appName: 'Yayatoh Staff',
      identity,
      apiBaseUrl: extra.apiBaseUrl,
      catalogs,
      adapters: nativeAdapters('staff', identity.platform, extra),
      environment: extra.appEnv,
      ...(extra.sentryDsn ? { sentryDsn: extra.sentryDsn } : {}),
      // Nobody can update an app at the door: inside the event window the gate only nudges (P7-9).
      suppressRequiredUpdate: () => getDevice().insideEventWindow(),
    });
  }
  return core;
}

/**
 * The app's one door-device session (M7.4a): the `yyd_` token in the keychain, the heartbeat, wipe.
 * It sits beside the signed-in person's session, never inside it.
 */
export function getDevice(): DeviceSession {
  if (!device) {
    const { identity, storage, versionGate } = getCore();
    device = createDeviceSession({
      storage,
      apiBaseUrl: readAppExtra().apiBaseUrl,
      identity,
      battery: batteryPercent,
      onUpgradeRequired: (info) => void versionGate.upgradeRequired(info),
    });
  }
  return device;
}

/**
 * The exhibitor rep's portal session (M7.4a): bearer tokens from the emailed invitation and code,
 * in their own corner of secure storage, apart from an organizer's account session.
 */
export function getPortal(): PortalSession {
  if (!portal) {
    const { identity, storage, versionGate } = getCore();
    portal = createPortalSession({
      storage,
      apiBaseUrl: readAppExtra().apiBaseUrl,
      identity,
      onUpgradeRequired: (info) => void versionGate.upgradeRequired(info),
    });
  }
  return portal;
}
