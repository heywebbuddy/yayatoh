/**
 * The app's three long-lived objects and how they are wired (M7.4a): the `Core` (the person's
 * session, `/v1` client, query cache, version gate), the door device's session and the exhibitor
 * rep's portal session. Plain TypeScript with the phone's parts passed in, so a test builds the very
 * same wiring with fakes.
 *
 * The one rule that crosses them: nobody can update an app at the door, so while this device is
 * inside its event window the core's version gate only nudges (`suppressRequiredUpdate`, P7-9).
 */
import {
  type ClientIdentity,
  type Core,
  type CoreAdapters,
  type CoreOptions,
  createCore,
} from '@yayatoh/mobile-core';
import { createDeviceSession, type DeviceSession } from './device/session';
import { createPortalSession, type PortalSession } from './portal/session';

export interface StaffServicesOptions {
  readonly apiBaseUrl: string;
  readonly identity: ClientIdentity;
  readonly catalogs: CoreOptions['catalogs'];
  readonly adapters: CoreAdapters;
  readonly battery?: () => Promise<number | null>;
  readonly environment?: string;
  readonly sentryDsn?: string;
}

export interface StaffServices {
  readonly core: Core;
  readonly device: DeviceSession;
  readonly portal: PortalSession;
}

export function createStaffServices(options: StaffServicesOptions): StaffServices {
  let device: DeviceSession | undefined;
  const core = createCore({
    appName: 'Yayatoh Staff',
    identity: options.identity,
    apiBaseUrl: options.apiBaseUrl,
    catalogs: options.catalogs,
    adapters: options.adapters,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.sentryDsn ? { sentryDsn: options.sentryDsn } : {}),
    suppressRequiredUpdate: () => device?.insideEventWindow() ?? false,
  });
  const onUpgradeRequired = (info: Parameters<Core['versionGate']['upgradeRequired']>[0]) =>
    void core.versionGate.upgradeRequired(info);
  device = createDeviceSession({
    storage: core.storage,
    apiBaseUrl: options.apiBaseUrl,
    identity: options.identity,
    ...(options.battery ? { battery: options.battery } : {}),
    ...(options.adapters.fetch ? { fetch: options.adapters.fetch } : {}),
    onUpgradeRequired,
  });
  const portal = createPortalSession({
    storage: core.storage,
    apiBaseUrl: options.apiBaseUrl,
    identity: options.identity,
    ...(options.adapters.fetch ? { fetch: options.adapters.fetch } : {}),
    onUpgradeRequired,
  });
  return { core, device, portal };
}
