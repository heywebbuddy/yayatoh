/**
 * The real `PushPort`: `expo-notifications` for the permission, the token and the events, React
 * Native's `Linking` for the phone's settings page. Not imported by tests (they pass a fake).
 */
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import type { DevicePushToken, IncomingPush, PushPermission, PushPort } from './port';

/** The Android channel every push uses. Created before the permission is asked (Android 13+). */
export const ANDROID_CHANNEL_ID = 'default';

function permissionOf(status: Notifications.NotificationPermissionsStatus): PushPermission {
  if (status.granted) return 'granted';
  if (status.status === 'undetermined') return 'undetermined';
  // `canAskAgain` is false once the person denied twice (Android) or once (iOS): only the phone's
  // settings can change it. A first Android denial is still `denied` for the app's purposes.
  return 'denied';
}

function tokenOf(raw: Notifications.DevicePushToken): DevicePushToken | null {
  if (typeof raw.data !== 'string' || raw.data === '') return null;
  if (raw.type === 'ios') return { platform: 'apns', token: raw.data };
  if (raw.type === 'android') return { platform: 'fcm', token: raw.data };
  return null;
}

function pushOf(n: Notifications.Notification): IncomingPush {
  const c = n.request.content;
  return {
    id: n.request.identifier,
    title: c.title ?? null,
    body: c.body ?? null,
    data: c.data,
  };
}

export function expoPushPort(): PushPort {
  // The channel's name in the phone's notification settings; the app sets the translated one.
  let channelName = 'Yayatoh';
  // The system shows nothing while the app is open: the app draws its own banner (no sound, no
  // badge), so the same text is never shown twice.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  const ensureChannel = async () => {
    if (Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: channelName,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  };

  return {
    setChannelName(name) {
      channelName = name;
    },
    async getPermission() {
      return permissionOf(await Notifications.getPermissionsAsync());
    },
    async requestPermission() {
      await ensureChannel();
      return permissionOf(
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: false, allowSound: true },
        }),
      );
    },
    async getDeviceToken() {
      try {
        await ensureChannel();
        return tokenOf(await Notifications.getDevicePushTokenAsync());
      } catch {
        // No Google services, a simulator, or the permission was refused: no token, no push.
        return null;
      }
    },
    onTokenChange(listener) {
      const sub = Notifications.addPushTokenListener((raw) => {
        const token = tokenOf(raw);
        if (token) listener(token);
      });
      return () => sub.remove();
    },
    onForeground(listener) {
      const sub = Notifications.addNotificationReceivedListener((n) => listener(pushOf(n)));
      return () => sub.remove();
    },
    onTap(listener) {
      const sub = Notifications.addNotificationResponseReceivedListener((r) => {
        if (r.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) listener(pushOf(r.notification));
      });
      return () => sub.remove();
    },
    async takeLaunchPush() {
      const r = await Notifications.getLastNotificationResponseAsync();
      if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
      await Notifications.clearLastNotificationResponseAsync();
      return pushOf(r.notification);
    },
    async openSystemSettings() {
      await Linking.openSettings();
    },
  };
}
