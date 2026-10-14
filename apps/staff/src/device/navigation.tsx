/**
 * Navigation that follows the device (M7.4a), mounted once in the root layout.
 */
import * as Linking from 'expo-linking';
import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { enrolmentFromLink, looksLikeEnrolmentLink } from './link';
import { useDevice } from './provider';

/**
 * Opens the enrolment screen for an enrolment link that opened the app from outside (a camera scan
 * of the QR, a message). The key goes to the screen as a route param and is cleared from it as soon
 * as it is read; nothing here logs the link.
 */
export function EnrolmentLinks() {
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
export function DeviceGuard() {
  const { loaded, status } = useDevice();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loaded || status === 'enrolled') return;
    if (/^\/(?:scan|select)(?:\/|$)/.test(pathname)) router.replace('/enrol');
  }, [loaded, status, pathname, router]);
  return null;
}
