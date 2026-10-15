/**
 * The Expo adapter (`expo-port.ts`) and the native-intent hook, with `expo-notifications` and the
 * core faked: what the phone returns is mapped to the port's types, and nothing else.
 */
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  addPushTokenListener: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(async () => {}),
  DEFAULT_ACTION_IDENTIFIER: 'default',
  AndroidImportance: { DEFAULT: 3 },
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: {
    openSettings: jest.fn(async () => {}),
    openURL: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    getInitialURL: jest.fn(async () => null),
  },
}));

import { Platform } from 'react-native';

// Hoisting puts the mocks above the imports, so the mock object is read back from the module registry.
const mockNotifications = jest.requireMock('expo-notifications');

import { redirectSystemPath } from '../src/app/+native-intent';
import { expoPushPort } from '../src/push/expo-port';
import { ORDER_ID, TICKET_ID } from './helpers/push-ids';

const status = (s: 'granted' | 'denied' | 'undetermined') => ({
  status: s,
  granted: s === 'granted',
  canAskAgain: s !== 'denied',
  expires: 'never',
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('expoPushPort', () => {
  it('shows nothing itself while the app is open (the app draws its own banner)', async () => {
    expoPushPort();
    expect(mockNotifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = mockNotifications.setNotificationHandler.mock.calls[0]?.[0];
    expect(await handler.handleNotification({})).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['undetermined', 'undetermined'],
  ] as const)('maps the phone’s %s', async (from, to) => {
    mockNotifications.getPermissionsAsync.mockResolvedValue(status(from));
    expect(await expoPushPort().getPermission()).toBe(to);
  });

  it('asks the phone for alerts and sound, never for badges', async () => {
    mockNotifications.requestPermissionsAsync.mockResolvedValue(status('granted'));
    expect(await expoPushPort().requestPermission()).toBe('granted');
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
  });

  it('creates the Android channel, named in the app’s language, before asking (Android 13+)', async () => {
    const original = Platform.OS;
    Platform.OS = 'android';
    try {
      mockNotifications.requestPermissionsAsync.mockResolvedValue(status('denied'));
      const port = expoPushPort();
      port.setChannelName?.('Entradas y eventos');
      await port.requestPermission();
      expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', {
        name: 'Entradas y eventos',
        importance: 3,
      });
    } finally {
      Platform.OS = original;
    }
  });

  it('maps an iOS token to APNs and an Android token to FCM, and gives nothing for anything else', async () => {
    const port = expoPushPort();
    mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: 'ab12' });
    expect(await port.getDeviceToken()).toEqual({ platform: 'apns', token: 'ab12' });
    mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm:xyz' });
    expect(await port.getDeviceToken()).toEqual({ platform: 'fcm', token: 'fcm:xyz' });
    mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'web', data: {} });
    expect(await port.getDeviceToken()).toBeNull();
    mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: '' });
    expect(await port.getDeviceToken()).toBeNull();
  });

  it('no token (a simulator, no Google services) is null, not an error', async () => {
    mockNotifications.getDevicePushTokenAsync.mockRejectedValue(new Error('E_REGISTRATION_FAILED'));
    expect(await expoPushPort().getDeviceToken()).toBeNull();
  });

  it('passes token rotations, foreground notifications and taps on, and removes its listeners', () => {
    const remove = jest.fn();
    mockNotifications.addPushTokenListener.mockReturnValue({ remove });
    mockNotifications.addNotificationReceivedListener.mockReturnValue({ remove });
    mockNotifications.addNotificationResponseReceivedListener.mockReturnValue({ remove });
    const port = expoPushPort();

    const tokens: unknown[] = [];
    const stopTokens = port.onTokenChange((t) => tokens.push(t));
    mockNotifications.addPushTokenListener.mock.calls[0]?.[0]({ type: 'android', data: 'new-token' });
    mockNotifications.addPushTokenListener.mock.calls[0]?.[0]({ type: 'web', data: {} });
    expect(tokens).toEqual([{ platform: 'fcm', token: 'new-token' }]);

    const shown: unknown[] = [];
    const stopForeground = port.onForeground((p) => shown.push(p));
    mockNotifications.addNotificationReceivedListener.mock.calls[0]?.[0]({
      request: {
        identifier: 'n1',
        content: { title: 'Summit', body: 'Changed', data: { path: '/events/x' } },
      },
    });
    expect(shown).toEqual([{ id: 'n1', title: 'Summit', body: 'Changed', data: { path: '/events/x' } }]);

    const taps: unknown[] = [];
    const stopTaps = port.onTap((p) => taps.push(p));
    const listener = mockNotifications.addNotificationResponseReceivedListener.mock.calls[0]?.[0];
    const note = { request: { identifier: 'n2', content: { title: null, body: null, data: {} } } };
    listener({ actionIdentifier: 'default', notification: note });
    listener({ actionIdentifier: 'some-other-action', notification: note });
    expect(taps).toEqual([{ id: 'n2', title: null, body: null, data: {} }]);

    stopTokens();
    stopForeground();
    stopTaps();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('hands over the notification that launched the app once, and clears it', async () => {
    const port = expoPushPort();
    mockNotifications.getLastNotificationResponseAsync.mockResolvedValue({
      actionIdentifier: 'default',
      notification: {
        request: { identifier: 'n3', content: { title: 'T', body: 'B', data: { path: '/orders/x' } } },
      },
    });
    expect(await port.takeLaunchPush()).toEqual({
      id: 'n3',
      title: 'T',
      body: 'B',
      data: { path: '/orders/x' },
    });
    expect(mockNotifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
    mockNotifications.getLastNotificationResponseAsync.mockResolvedValue(null);
    expect(await port.takeLaunchPush()).toBeNull();
  });

  it('opens this app’s page in the phone’s settings', async () => {
    const Linking = jest.requireMock('react-native/Libraries/Linking/Linking').default;
    await expoPushPort().openSystemSettings();
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('a launch by an action button (not a plain tap) opens nothing', async () => {
    mockNotifications.getLastNotificationResponseAsync.mockResolvedValue({
      actionIdentifier: 'mark-read',
      notification: { request: { identifier: 'n4', content: { data: {} } } },
    });
    expect(await expoPushPort().takeLaunchPush()).toBeNull();
  });
});

jest.mock('../src/core', () => {
  const session = { restore: jest.fn() };
  return { getCore: () => ({ session }), mockSession: session };
});
const mockSession = jest.requireMock('../src/core').mockSession;

describe('+native-intent', () => {
  it('maps a universal link, a custom-scheme link and the checkout return link', async () => {
    mockSession.restore.mockResolvedValue({ status: 'signedIn' });
    const path = (p: string) => redirectSystemPath({ path: p, initial: true });
    expect(await path('https://acme.yayatoh.events/events/summit')).toBe('/events/summit?org=acme');
    expect(await path('yayatoh://claim/tok_1234567890')).toBe('/claim/tok_1234567890');
    expect(await path(`https://app.yayatoh.com/events/summit?checkout=return&order=${ORDER_ID}`)).toBe(
      `/events/summit?checkout=return&order=${ORDER_ID}`,
    );
    expect(await path('https://app.yayatoh.com/nothing/here')).toBe('/');
  });

  it('waits for the session to be restored, so a cold start knows whether the person is signed in', async () => {
    mockSession.restore.mockResolvedValue({ status: 'signedOut', reason: null });
    expect(
      await redirectSystemPath({ path: 'https://app.yayatoh.com/my-tickets/holdertoken123', initial: true }),
    ).toBe('/');
    expect(mockSession.restore).toHaveBeenCalled();
  });

  it('never crashes the launch: a failure lands on Home', async () => {
    mockSession.restore.mockRejectedValue(new Error('keychain'));
    expect(
      await redirectSystemPath({ path: `https://app.yayatoh.com/my-tickets/holdertoken123`, initial: true }),
    ).toBe('/');
    expect(TICKET_ID).toBeTruthy();
  });
});
