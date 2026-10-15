/**
 * What the device session needs from the core (M7.4a), mounted once inside both providers:
 * - the cached server state belongs to the enrolment that ended, so a wipe clears it;
 * - when the event's dates become known (or change) the version gate is asked again, because the
 *   window decides whether a required update may show.
 */
import { clearServerState, useCore } from '@yayatoh/mobile-core';
import { useEffect, useSyncExternalStore } from 'react';
import { useDeviceSession } from './provider';
import type { DeviceState } from './session';

export function DeviceCoreBridge() {
  const core = useCore();
  const session = useDeviceSession();
  const state: DeviceState = useSyncExternalStore(
    session.subscribe,
    () => session.state,
    () => session.state,
  );
  useEffect(() => session.onWipe(() => clearServerState(core.queryClient, core.persister)), [session, core]);
  const windowKey = state.event ? `${state.event.startsAt}|${state.event.endsAt}` : '';
  useEffect(() => {
    if (windowKey) void core.versionGate.check();
  }, [windowKey, core]);
  return null;
}
