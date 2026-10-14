/**
 * `CoreProvider` (M7.1c): mounts everything the core owns around the app's screens, in this order:
 * theme, language, the persisted query cache, the version gate. It also runs the start-up work:
 * restore the session, read the cache, check `/v1/mobile/config`, and point Query at the network.
 */
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from 'react';
import { persistOptions } from './cache/query-client';
import type { Core } from './core';
import { LocaleProvider } from './i18n/provider';
import { bindQueryToNetwork } from './platform/network';
import type { SessionState } from './session/session-store';
import { ThemeProvider } from './theme/provider';
import { VersionGateView } from './version/components';

const CoreContext = createContext<Core | null>(null);

export function useCore(): Core {
  const core = useContext(CoreContext);
  if (!core) throw new Error('useCore needs a CoreProvider');
  return core;
}

/** The session state; re-renders when the person signs in or out. */
export function useSession(): SessionState {
  const { session } = useCore();
  return useSyncExternalStore(
    session.subscribe,
    () => session.state,
    () => session.state,
  );
}

export interface CoreProviderProps {
  readonly core: Core;
  readonly children: ReactNode;
  /** Test seam: skip binding Query to the phone's network. */
  readonly bindNetwork?: boolean;
}

export function CoreProvider({ core, children, bindNetwork = true }: CoreProviderProps) {
  useEffect(() => {
    void core.session.restore();
    void core.versionGate.check();
  }, [core]);

  useEffect(() => (bindNetwork ? bindQueryToNetwork() : undefined), [bindNetwork]);

  return (
    <CoreContext.Provider value={core}>
      <ThemeProvider store={core.storage}>
        <LocaleProvider catalogs={core.catalogs} store={core.storage}>
          <PersistQueryClientProvider
            client={core.queryClient}
            persistOptions={persistOptions(core.persister, core.identity.version)}
          >
            <VersionGateView gate={core.versionGate} appName={core.appName}>
              {children}
            </VersionGateView>
          </PersistQueryClientProvider>
        </LocaleProvider>
      </ThemeProvider>
    </CoreContext.Provider>
  );
}
