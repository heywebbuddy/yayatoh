/**
 * `DeviceProvider` and `useDevice()` (M7.4a): the door device's enrolment as React state. Mount it
 * once, inside `CoreProvider`; M7.4b and M7.4c read the device and its `/v1` client from here.
 *
 * While the device is enrolled and the app is in the foreground it sends a heartbeat every 30 s
 * (battery, queue depth, clock offset); a 401 or a wipe command erases local data and the root
 * layout returns to the enrolment screen.
 */
import { clearServerState, useCore } from '@yayatoh/mobile-core';
import type { YayatohClient } from '@yayatoh/sdk';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import type { Enrolment } from './link';
import type { DeviceSession, DeviceState, EnrolOutcome, WipeReason } from './session';

const DeviceContext = createContext<DeviceSession | null>(null);

export interface DeviceApi extends DeviceState {
  /** Enrols with a scanned or opened link (or its two parts). */
  enrol(link: string | Enrolment): Promise<EnrolOutcome>;
  /** Chooses where this device scans (null: the whole event). */
  selectCheckpoint(id: string | null): Promise<boolean>;
  /** Removes this enrolment and the local data that depends on it. */
  forget(): Promise<void>;
  /** Dismisses the "revoked" or "wiped" notice. */
  acknowledgeEnded(): Promise<void>;
  /** Registers what to delete on wipe, revoke or removal (M7.4b: the manifest database). */
  onWipe(callback: (reason: WipeReason) => void | Promise<void>): () => void;
  /** A supervisor asked this device to sync now. */
  onSyncRequested(callback: () => void | Promise<void>): () => void;
  /** Where the heartbeat reads the outbox's queue depth (0 until M7.4b registers). */
  setQueueDepthSource(source: () => number | Promise<number>): () => void;
  /** The `/v1` client signed with the device token: the only client that carries it. */
  readonly api: YayatohClient;
  /** Reads the event's name, dates and places again. */
  refreshEvent(): Promise<boolean>;
  /** One heartbeat now (also sent every 30 s). */
  heartbeat: DeviceSession['heartbeat'];
  /** The device clock's offset from the server's (server − device), in ms. */
  readonly clockOffsetMs: number;
}

export interface DeviceProviderProps {
  readonly session: DeviceSession;
  readonly children: ReactNode;
  /** Test seam: skip the foreground heartbeat timer. */
  readonly heartbeat?: boolean;
}

export function DeviceProvider({ session, children, heartbeat = true }: DeviceProviderProps) {
  const core = useCore();
  const state = useSyncExternalStore(
    session.subscribe,
    () => session.state,
    () => session.state,
  );

  useEffect(() => {
    void session.restore();
  }, [session]);

  // Whatever the cached server state holds belongs to the enrolment that ended.
  useEffect(() => session.onWipe(() => clearServerState(core.queryClient, core.persister)), [session, core]);

  const enrolled = state.status === 'enrolled';
  useEffect(() => {
    if (!heartbeat || !enrolled) return;
    if (AppState.currentState === 'active') session.startHeartbeat();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') session.startHeartbeat();
      else session.stopHeartbeat();
    });
    return () => {
      sub.remove();
      session.stopHeartbeat();
    };
  }, [session, enrolled, heartbeat]);

  // The event's dates just became known (or changed): the gate may now lift an update screen.
  const windowKey = state.event ? `${state.event.startsAt}|${state.event.endsAt}` : '';
  useEffect(() => {
    if (windowKey) void core.versionGate.check();
  }, [windowKey, core]);

  return <DeviceContext.Provider value={session}>{children}</DeviceContext.Provider>;
}

export function useDeviceSession(): DeviceSession {
  const session = useContext(DeviceContext);
  if (!session) throw new Error('useDevice needs a DeviceProvider');
  return session;
}

/** The enrolled device: its state and the actions that change it. */
export function useDevice(): DeviceApi {
  const session = useDeviceSession();
  const state = useSyncExternalStore(
    session.subscribe,
    () => session.state,
    () => session.state,
  );
  const enrol = useCallback((link: string | Enrolment) => session.enrol(link), [session]);
  return useMemo(
    () => ({
      ...state,
      enrol,
      selectCheckpoint: session.selectCheckpoint,
      forget: session.forget,
      acknowledgeEnded: session.acknowledgeEnded,
      onWipe: session.onWipe,
      onSyncRequested: session.onSyncRequested,
      setQueueDepthSource: session.setQueueDepthSource,
      api: session.api,
      refreshEvent: session.refreshEvent,
      heartbeat: session.heartbeat,
      clockOffsetMs: session.clockOffsetMs,
    }),
    [state, session, enrol],
  );
}
