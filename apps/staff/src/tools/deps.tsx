/**
 * What the door-tool screens need from the rest of the app (M7.4c), passed down in one context so
 * every screen is tested with fakes and no network, camera or storage. The Staff app builds the
 * real one in `runtime.tsx` from the device session (M7.4a), the saved manifest and offline
 * scanner (M7.4b), the exhibitor and organizer sessions and the phone's adapters.
 */
import { createContext, type ComponentType, type ReactNode, useContext } from 'react';
import type { OpsApi, PortalApi, StaffApi } from './api';
import type { ManifestSource } from './lookup';
import type { OfflineCheckIn } from './manual-checkin';
import type { Vault } from './vault';

/** The enrolled door device (M7.4a's `useDevice()`), reduced to what the tools use. */
export interface ToolsDevice {
  readonly deviceId: string;
  readonly eventId: string;
  readonly checkpointId: string | null;
}

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** The phone's push service (`expo-notifications`), behind a port so tests use a fake. */
export interface PushPort {
  permission(): Promise<PushPermission>;
  request(): Promise<PushPermission>;
  /** The APNs or FCM registration token, or null when the phone cannot give one. */
  token(): Promise<{ platform: 'apns' | 'fcm'; token: string; appId: string | null } | null>;
}

export interface ScannerProps {
  /** Called once per distinct code read. */
  readonly onCode: (code: string) => void;
  readonly active: boolean;
}

export interface ToolsDeps {
  readonly device: ToolsDevice | null;
  readonly staff: StaffApi | null;
  /** The exhibitor rep's session (`owner` identifies the rep for the lead outbox), when signed in. */
  readonly portal: { readonly api: PortalApi; readonly owner: string } | null;
  /** The organizer's session and the event they chose, when signed in. */
  readonly organizer: { readonly api: OpsApi; readonly org: string; readonly eventId: string } | null;
  /** The saved manifest of the phone (M7.4b), or null when there is none yet. */
  readonly manifest: () => Promise<ManifestSource | null>;
  readonly offlineCheckIn: OfflineCheckIn | null;
  readonly vault: Vault;
  readonly push: PushPort;
  /** The camera view (M7.4b); null shows manual code entry only. */
  readonly Scanner: ComponentType<ScannerProps> | null;
  readonly clock: { now(): Date; offsetMs(): number };
  readonly newId: () => string;
  /** True while the phone has no connection (mobile-core's `useIsOffline` in the app). */
  readonly useOffline: () => boolean;
  /** Plays the verdict's sound and haptic (M7.4b); optional. */
  readonly feedback?: (tone: 'ok' | 'warn' | 'stop') => void;
}

const ToolsContext = createContext<ToolsDeps | null>(null);

export function ToolsProvider({ deps, children }: { deps: ToolsDeps; children: ReactNode }) {
  return <ToolsContext.Provider value={deps}>{children}</ToolsContext.Provider>;
}

export function useTools(): ToolsDeps {
  const deps = useContext(ToolsContext);
  if (!deps) throw new Error('The door tools need a ToolsProvider');
  return deps;
}
