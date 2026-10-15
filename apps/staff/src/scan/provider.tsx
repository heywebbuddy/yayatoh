/**
 * Opens the scanner for the enrolled device (M7.4b) and keeps it running: the encrypted database,
 * the engine, and the scheduler that sends the outbox and refreshes the list. Mount it once, inside
 * `DeviceProvider`, in the root layout, so a door phone keeps sending its queue whichever screen is open.
 *
 * It also registers the wipe: when the device layer revokes, wipes or forgets the device, the
 * database and its key are deleted whether or not the scan screen is open.
 */
import { reportError, useCore, useIsOffline } from '@yayatoh/mobile-core';
import * as Crypto from 'expo-crypto';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useDevice } from '../device';
import { ScanAuthError, ScanSyncError, sdkScanApi } from './api';
import { nativeSqlite, openNativeScanDb } from './native-db';
import { openScanRuntime, registerScanWipe, type ScanRuntime } from './runtime';

const ScanContext = createContext<ScanRuntime | null>(null);

/** The scanner for the enrolled device, or null until it is open (or when not enrolled). */
export const useScanRuntime = (): ScanRuntime | null => useContext(ScanContext);

/** Errors worth a crash report: not "no network", not a refused token (the device layer handles that). */
const worthReporting = (e: unknown) =>
  !(e instanceof ScanAuthError) && !(e instanceof ScanSyncError) && !(e instanceof TypeError);

const randomBytes = (n: number) => Crypto.getRandomBytes(n);

export function ScanProvider({ children }: { readonly children: ReactNode }) {
  const core = useCore();
  const device = useDevice();
  const offline = useIsOffline();
  const [runtime, setRuntime] = useState<ScanRuntime | null>(null);

  const { onWipe, setQueueDepthSource, onSyncRequested, api } = device;
  const enrolled = device.status === 'enrolled' && device.eventId !== null;
  const eventId = device.eventId;

  // The wipe is registered before anything can restore a half-finished one (children's effects run
  // before the DeviceProvider's own `restore`).
  useEffect(
    () => registerScanWipe(onWipe, { storage: core.storage, sqlite: nativeSqlite }),
    [onWipe, core.storage],
  );

  useEffect(() => {
    if (!enrolled || !eventId) {
      setRuntime(null);
      return;
    }
    let live = true;
    let opened: ScanRuntime | null = null;
    openScanRuntime({
      eventId,
      api: sdkScanApi(api),
      random: randomBytes,
      storage: core.storage,
      sqlite: nativeSqlite,
      openDb: () => openNativeScanDb(core.storage, randomBytes),
      onError: (e) => {
        if (worthReporting(e)) reportError(e);
      },
    })
      .then((rt) => {
        if (!live) return;
        opened = rt;
        setRuntime(rt);
        rt.scheduler.start();
      })
      .catch((e) => {
        if (worthReporting(e)) reportError(e);
      });
    return () => {
      live = false;
      opened?.scheduler.stop();
    };
  }, [enrolled, eventId, api, core.storage]);

  useEffect(() => {
    runtime?.engine.setCheckpoint(device.checkpointId);
  }, [runtime, device.checkpointId]);

  useEffect(() => {
    if (!runtime) return;
    const stopDepth = setQueueDepthSource(() => runtime.engine.queueDepth);
    const stopSync = onSyncRequested(() => runtime.scheduler.syncNow());
    return () => {
      stopDepth();
      stopSync();
    };
  }, [runtime, setQueueDepthSource, onSyncRequested]);

  useEffect(() => {
    runtime?.scheduler.setOnline(!offline);
  }, [runtime, offline]);

  useEffect(() => {
    if (!runtime) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void runtime.engine.expireIfDue();
        runtime.scheduler.kick();
      }
    });
    return () => sub.remove();
  }, [runtime]);

  const value = useMemo(() => runtime, [runtime]);
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}
