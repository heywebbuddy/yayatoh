import { CoreProvider, OfflineBanner, useColors, useIsOffline } from '@yayatoh/mobile-core';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCore } from '../core';

/** The offline banner sits under the status bar and only takes room while the phone is offline. */
function OfflineStrip() {
  const offline = useIsOffline();
  if (!offline) return null;
  return (
    <SafeAreaView edges={['top']}>
      <OfflineBanner offline />
    </SafeAreaView>
  );
}

function ThemedStack() {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <OfflineStrip />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
    </View>
  );
}

export default function RootLayout() {
  const core = useMemo(getCore, []);
  return (
    <CoreProvider core={core}>
      <StatusBar style="auto" />
      <ThemedStack />
    </CoreProvider>
  );
}
