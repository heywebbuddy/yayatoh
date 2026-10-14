/**
 * Network state (M7.1c): whether the phone can reach the internet, an offline banner, and the hook
 * that makes TanStack Query pause and resume with it. `expo-network` is the only source.
 */
import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { bindOnlineManager } from '../cache/query-client';
import { useColors } from '../theme/provider';
import { px, radius, space, type } from '../theme/theme';

export interface NetworkSnapshot {
  readonly isConnected?: boolean | null;
  readonly isInternetReachable?: boolean | null;
}

/** Offline when the phone says it has no connection, or has one that reaches nothing. Unknown is online. */
export const isOffline = (s: NetworkSnapshot | null | undefined): boolean =>
  s?.isConnected === false || s?.isInternetReachable === false;

/** Subscribes to connectivity changes; returns the unsubscribe. */
export function subscribeToNetwork(listener: (online: boolean) => void): () => void {
  const sub = Network.addNetworkStateListener((state) => listener(!isOffline(state)));
  return () => sub.remove();
}

/** Points TanStack Query's online state at the phone's. Call once at start. */
export const bindQueryToNetwork = () => bindOnlineManager(subscribeToNetwork);

/** True while the phone is offline. Starts online until the first reading. */
export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let live = true;
    Network.getNetworkStateAsync()
      .then((s) => live && setOffline(isOffline(s)))
      .catch(() => {});
    const unsubscribe = subscribeToNetwork((online) => setOffline(!online));
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return offline;
}

export interface OfflineBannerProps {
  /** For tests, and for screens that already know. Defaults to the phone's state. */
  readonly offline?: boolean;
  /** Changes waiting to be sent; adds a count to the message. */
  readonly queued?: number;
}

/** A banner for the top of a screen while offline; renders nothing online. */
export function OfflineBanner({ offline, queued = 0 }: OfflineBannerProps) {
  const detected = useIsOffline();
  const t = useTranslations('core.offline');
  const colors = useColors();
  if (!(offline ?? detected)) return null;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: colors.warningSoft, borderColor: colors.line }]}
      testID="offline-banner"
    >
      <Text style={[styles.text, { color: colors.ink }]}>{t('banner')}</Text>
      {queued > 0 ? (
        <Text style={[styles.text, { color: colors.ink2 }]}>{t('queued', { count: queued })}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.tag),
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[1],
  },
  text: { fontSize: type.body.size, lineHeight: type.body.size * type.body.lineHeight, textAlign: 'auto' },
});
