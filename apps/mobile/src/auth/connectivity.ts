import * as Network from 'expo-network';
import { useCallback, useEffect, useState } from 'react';

/** Offline when the phone says it has no connection or one that reaches nothing; unknown is online. */
const offlineOf = (s: Network.NetworkState | null | undefined): boolean =>
  s?.isConnected === false || s?.isInternetReachable === false;

/**
 * Whether the phone is offline, with a way to check again. The welcome screen uses it to explain a
 * first launch without a network and to offer "Try again" instead of a dead end.
 */
export function useConnectivity() {
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setOffline(offlineOf(await Network.getNetworkStateAsync()));
    } catch {
      // The reading itself failed: stay as we were.
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void recheck();
    const sub = Network.addNetworkStateListener((state) => setOffline(offlineOf(state)));
    return () => sub.remove();
  }, [recheck]);

  return { offline, checking, recheck };
}
