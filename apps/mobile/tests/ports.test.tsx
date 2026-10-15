import { renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { useShopPorts } from '../src/shop/ports';

jest.mock('expo-location', () => ({
  hasServicesEnabledAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  openBrowserAsync: jest.fn(),
  dismissAuthSession: jest.fn(),
  dismissBrowser: jest.fn(),
}));
let mockUuids = 0;
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `uuid-${++mockUuids}`) }));

type Mocked<K extends string> = { [P in K]: jest.Mock };
const mockLocation = Location as unknown as Mocked<
  | 'hasServicesEnabledAsync'
  | 'requestForegroundPermissionsAsync'
  | 'getLastKnownPositionAsync'
  | 'getCurrentPositionAsync'
>;
const mockBrowser = WebBrowser as unknown as Mocked<
  'openAuthSessionAsync' | 'openBrowserAsync' | 'dismissAuthSession' | 'dismissBrowser'
>;

const ports = () => renderHook(() => useShopPorts()).result.current;

beforeEach(() => {
  jest.clearAllMocks();
  mockLocation.hasServicesEnabledAsync.mockResolvedValue(true);
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
  mockLocation.getLastKnownPositionAsync.mockResolvedValue(null);
  mockLocation.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 38.7, longitude: -9.1 } });
});

describe('the phone’s location, asked only for "near me"', () => {
  it('asks while the app is open and reads one position', async () => {
    expect(await ports().location.requestNearMe()).toEqual({
      status: 'granted',
      near: { lat: 38.7, lng: -9.1 },
    });
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
  });

  it('prefers a recent position to waking the GPS', async () => {
    mockLocation.getLastKnownPositionAsync.mockResolvedValue({ coords: { latitude: 1, longitude: 2 } });
    expect(await ports().location.requestNearMe()).toEqual({ status: 'granted', near: { lat: 1, lng: 2 } });
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('reports a refusal, and whether the person can be asked again', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    });
    expect(await ports().location.requestNearMe()).toEqual({ status: 'denied', canAskAgain: false });
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: true });
    expect(await ports().location.requestNearMe()).toEqual({ status: 'denied', canAskAgain: true });
  });

  it('does not even ask when location services are off, or the phone cannot find itself', async () => {
    mockLocation.hasServicesEnabledAsync.mockResolvedValue(false);
    expect(await ports().location.requestNearMe()).toEqual({ status: 'unavailable' });
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    mockLocation.hasServicesEnabledAsync.mockResolvedValue(true);
    mockLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));
    expect(await ports().location.requestNearMe()).toEqual({ status: 'unavailable' });
  });

  it('opens the app’s Settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await ports().location.openSettings();
    expect(open).toHaveBeenCalled();
  });
});

describe('the secure browser session', () => {
  it('opens the payment page as an auth session and reports the return link it ended on', async () => {
    mockBrowser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'https://x.test/events/a?checkout=return',
    });
    expect(await ports().browser.openPayment('https://pay.test/1', 'https://x.test/events/a')).toEqual({
      type: 'return',
      url: 'https://x.test/events/a?checkout=return',
    });
    expect(mockBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://pay.test/1',
      'https://x.test/events/a',
    );
  });

  it.each(['cancel', 'dismiss', 'locked'])('a session that ends as %s is a closed sheet', async (type) => {
    mockBrowser.openAuthSessionAsync.mockResolvedValue({ type });
    expect(await ports().browser.openPayment('https://pay.test/1', 'https://x.test/e')).toEqual({
      type: 'closed',
    });
  });

  it('falls back to the plain secure browser when the auth session cannot watch the return link', async () => {
    mockBrowser.openAuthSessionAsync.mockRejectedValue(new Error('invalid callback scheme'));
    mockBrowser.openBrowserAsync.mockResolvedValue({ type: 'cancel' });
    expect(await ports().browser.openPayment('https://pay.test/1', 'https://x.test/e')).toEqual({
      type: 'closed',
    });
    expect(mockBrowser.openBrowserAsync).toHaveBeenCalledWith('https://pay.test/1');
  });

  it('opens web pages, other apps’ links and closes a session left open', async () => {
    const link = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const p = ports();
    await p.browser.openWeb('https://x.test/events/a');
    expect(mockBrowser.openBrowserAsync).toHaveBeenCalledWith('https://x.test/events/a');
    await p.browser.openExternal('https://maps.test/hall');
    expect(link).toHaveBeenCalledWith('https://maps.test/hall');
    await p.browser.dismiss();
    expect(mockBrowser.dismissAuthSession).toHaveBeenCalled();
    expect(mockBrowser.dismissBrowser).toHaveBeenCalled();
  });

  it('closing a session that is not open is harmless', async () => {
    mockBrowser.dismissAuthSession.mockImplementation(() => {
      throw new Error('none');
    });
    await expect(ports().browser.dismiss()).resolves.toBeUndefined();
  });
});

describe('the short-code lookup and the rest', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('follows the web’s redirect and reads the event from where it ends', async () => {
    global.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      url: 'https://x.test/ar/events/summer-jazz?x=1',
    })) as never;
    expect(await ports().links.resolveShortCode('https://x.test/', 'Xk3p9')).toBe('summer-jazz');
    expect(global.fetch).toHaveBeenCalledWith('https://x.test/e/Xk3p9', {
      method: 'HEAD',
      redirect: 'follow',
    });
  });

  it('an unknown code is null; a server error is an error; a page that is no event is null', async () => {
    global.fetch = jest.fn(async () => ({ status: 404, ok: false, url: '' })) as never;
    expect(await ports().links.resolveShortCode('https://x.test', 'nope')).toBeNull();
    global.fetch = jest.fn(async () => ({ status: 500, ok: false, url: '' })) as never;
    await expect(ports().links.resolveShortCode('https://x.test', 'x')).rejects.toThrow();
    global.fetch = jest.fn(async () => ({ status: 200, ok: true, url: 'https://x.test/somewhere' })) as never;
    expect(await ports().links.resolveShortCode('https://x.test', 'x')).toBeNull();
  });

  it('a code is encoded into the path', async () => {
    global.fetch = jest.fn(async () => ({ status: 404, ok: false, url: '' })) as never;
    await ports().links.resolveShortCode('https://x.test', '../a b');
    expect(global.fetch).toHaveBeenCalledWith('https://x.test/e/..%2Fa%20b', expect.anything());
  });

  it('makes a fresh key each time, reads the clock and waits', async () => {
    const p = ports();
    expect(p.newKey()).not.toBe(p.newKey());
    expect(p.now()).toBeInstanceOf(Date);
    await expect(p.wait(1)).resolves.toBeUndefined();
  });
});
