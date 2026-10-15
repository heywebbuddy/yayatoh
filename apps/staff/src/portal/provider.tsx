/**
 * `PortalProvider` and `usePortal()` (M7.4a): the exhibitor rep's bearer session as React state.
 * Mount it once inside `CoreProvider`; the lead screens (M7.4c) read `api` and `status` from it.
 */
import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from 'react';
import type { PortalSession } from './session';

const PortalContext = createContext<PortalSession | null>(null);

export function PortalProvider({
  session,
  children,
}: {
  readonly session: PortalSession;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    void session.store.restore();
  }, [session]);
  return <PortalContext.Provider value={session}>{children}</PortalContext.Provider>;
}

export interface PortalApi {
  /** `loading` until the stored session is read; then `signedIn` or `signedOut`. */
  readonly status: 'loading' | 'signedIn' | 'signedOut';
  readonly api: PortalSession['api'];
  readonly requestCode: PortalSession['requestCode'];
  readonly verifyCode: PortalSession['verifyCode'];
  readonly signOut: PortalSession['signOut'];
  /** Runs when the rep's session ends, for any reason: clear what the leads screens cached. */
  readonly onSignedOut: PortalSession['store']['onSignedOut'];
}

export function usePortal(): PortalApi {
  const session = useContext(PortalContext);
  if (!session) throw new Error('usePortal needs a PortalProvider');
  const state = useSyncExternalStore(
    session.store.subscribe,
    () => session.store.state,
    () => session.store.state,
  );
  return {
    status: state.status,
    api: session.api,
    requestCode: session.requestCode,
    verifyCode: session.verifyCode,
    signOut: session.signOut,
    onSignedOut: session.store.onSignedOut,
  };
}
