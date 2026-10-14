import { CoreProvider, OfflineBanner, useColors, useIsOffline } from '@yayatoh/mobile-core';
import * as Linking from 'expo-linking';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCore, getDevice, getPortal } from '../core';
import {
  DeviceCoreBridge,
  DeviceProvider,
  enrolmentFromLink,
  looksLikeEnrolmentLink,
  useDevice,
} from '../device';
import { PortalProvider } from '../portal';

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

/**
 * Opens the enrolment screen for an enrolment link that opened the app from outside (a camera
 * scan of the QR, a message). The key goes to the screen as a route param and is cleared from it as
 * soon as it is read; nothing here logs the link.
 */
function EnrolmentLinks() {
  const router = useRouter();
  useEffect(() => {
    const open = (url: string | null) => {
      if (!url || !looksLikeEnrolmentLink(url)) return;
      const enrolment = enrolmentFromLink(url);
      router.navigate(
        enrolment
          ? { pathname: '/enrol', params: { event: enrolment.eventId, key: enrolment.token } }
          : { pathname: '/enrol', params: { invalid: '1' } },
      );
    };
    void Linking.getInitialURL().then(open, () => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => open(url));
    return () => subscription.remove();
  }, [router]);
  return null;
}

/**
 * The device gate: a device that is not enrolled (never was, or was revoked or wiped, or removed)
 * cannot stay on the scanner or the place picker. It goes back to enrolment at once, which is how a
 * wiped device returns within one heartbeat.
 */
function DeviceGuard() {
  const { loaded, status } = useDevice();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loaded || status === 'enrolled') return;
    if (/^\/(?:scan|select)(?:\/|$)/.test(pathname)) router.replace('/enrol');
  }, [loaded, status, pathname, router]);
  return null;
}

function ThemedStack() {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <OfflineStrip />
      <DeviceGuard />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
    </View>
  );
}

export default function RootLayout() {
  const core = useMemo(getCore, []);
  const device = useMemo(getDevice, []);
  const portal = useMemo(getPortal, []);
  return (
    <CoreProvider core={core}>
      <DeviceProvider session={device}>
        <PortalProvider session={portal}>
          <DeviceCoreBridge />
          <EnrolmentLinks />
          <StatusBar style="auto" />
          <ThemedStack />
        </PortalProvider>
      </DeviceProvider>
    </CoreProvider>
  );
}
