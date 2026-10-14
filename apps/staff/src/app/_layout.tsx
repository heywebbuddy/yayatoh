import { CoreProvider, useColors } from '@yayatoh/mobile-core';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { getCore } from '../core';

function ThemedStack() {
  const colors = useColors();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
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
