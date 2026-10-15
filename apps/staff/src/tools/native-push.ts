/**
 * The phone's push service for staff alerts (M7.4c): `expo-notifications` behind the `PushPort`.
 * The module is loaded on first use, so a build without it (or a test) shows "this phone could not
 * register" instead of failing to start. The token goes to the server and nowhere else.
 */
import { Platform } from 'react-native';
import type { PushPermission, PushPort } from './deps';

type Notifications = typeof import('expo-notifications');

function load(): Notifications | null {
  try {
    return require('expo-notifications') as Notifications;
  } catch {
    return null;
  }
}

const permissionOf = (status: string): PushPermission =>
  status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';

export const nativePush: PushPort = {
  async permission() {
    const n = load();
    if (!n) return 'denied';
    return permissionOf((await n.getPermissionsAsync()).status);
  },
  async request() {
    const n = load();
    if (!n) return 'denied';
    return permissionOf((await n.requestPermissionsAsync()).status);
  },
  async token() {
    const n = load();
    if (!n) return null;
    try {
      const t = await n.getDevicePushTokenAsync();
      if (typeof t.data !== 'string' || t.data.length < 8) return null;
      return { platform: Platform.OS === 'ios' ? 'apns' : 'fcm', token: t.data, appId: null };
    } catch {
      return null;
    }
  },
};
