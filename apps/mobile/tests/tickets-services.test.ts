import * as Brightness from 'expo-brightness';
import * as Calendar from 'expo-calendar';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import { type MapsTarget, mapsUrls, nativeServices } from '../src/tickets/services';

const target: MapsTarget = {
  label: 'Lakeside Pavilion',
  address: '1 Lake Shore Dr, Chicago',
  latitude: 41.88,
  longitude: -87.62,
  mapUrl: null,
};
const setPlatform = (os: 'ios' | 'android') => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
};
afterEach(() => {
  jest.restoreAllMocks();
  setPlatform('ios');
});

describe('mapsUrls', () => {
  it('opens Apple Maps at the point on iOS, then the web map', () => {
    expect(mapsUrls(target, 'ios')).toEqual([
      'https://maps.apple.com/?ll=41.88,-87.62&q=Lakeside%20Pavilion',
      'https://www.google.com/maps/search/?api=1&query=41.88,-87.62',
    ]);
  });
  it('uses a geo: link on Android', () => {
    expect(mapsUrls(target, 'android')[0]).toBe('geo:41.88,-87.62?q=41.88,-87.62(Lakeside%20Pavilion)');
  });
  it('searches by name and address when there are no coordinates', () => {
    const noPoint = { ...target, latitude: null, longitude: null };
    expect(mapsUrls(noPoint, 'ios')[0]).toBe(
      'https://maps.apple.com/?q=Lakeside%20Pavilion%2C%201%20Lake%20Shore%20Dr%2C%20Chicago',
    );
    expect(mapsUrls(noPoint, 'android')[0]).toBe(
      'geo:0,0?q=Lakeside%20Pavilion%2C%201%20Lake%20Shore%20Dr%2C%20Chicago',
    );
    expect(mapsUrls({ ...noPoint, address: null }, 'ios')[0]).toBe(
      'https://maps.apple.com/?q=Lakeside%20Pavilion',
    );
  });
  it('tries the venue’s own https map link first, and never another scheme', () => {
    expect(mapsUrls({ ...target, mapUrl: 'https://maps.example.test/p/1' }, 'ios')[0]).toBe(
      'https://maps.example.test/p/1',
    );
    expect(mapsUrls({ ...target, mapUrl: 'javascript:alert(1)' }, 'ios')[0]).toMatch(
      /^https:\/\/maps\.apple\.com/,
    );
    expect(mapsUrls({ ...target, mapUrl: 'http://insecure.test/x' }, 'ios')[0]).toMatch(
      /^https:\/\/maps\.apple\.com/,
    );
  });
});

describe('nativeServices', () => {
  it('opens the first maps link the phone can open', async () => {
    const can = jest.spyOn(Linking, 'canOpenURL').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    expect(await nativeServices.openMaps(target)).toBe(true);
    expect(can).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=41.88,-87.62');
  });
  it('reports a phone with no maps app', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    expect(await nativeServices.openMaps(target)).toBe(false);
  });
  it('carries on to the next link when one throws', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockRejectedValueOnce(new Error('x')).mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    expect(await nativeServices.openMaps(target)).toBe(true);
  });

  it('opens a wallet link, and says when the phone could not', async () => {
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('x'));
    expect(await nativeServices.openWalletLink('https://wallet.example.test/p')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://wallet.example.test/p');
    expect(await nativeServices.openWalletLink('https://wallet.example.test/p')).toBe(false);
  });

  it('opens the web in the secure browser session', async () => {
    await nativeServices.openWeb('https://web.example.test/x');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://web.example.test/x');
  });

  const details = {
    title: 'Summer Night',
    startsAt: new Date('2030-03-01T19:00:00Z'),
    endsAt: new Date('2030-03-01T23:00:00Z'),
    location: 'Lakeside Pavilion',
    notes: 'General admission · Lakeside Events',
  };

  it('asks for write-only calendar access and shows the system form on iOS', async () => {
    const add = jest.fn(async () => ({ action: 'saved' }));
    (Calendar.getDefaultCalendarSync as jest.Mock).mockReturnValueOnce({ addEventWithForm: add });
    expect(await nativeServices.addToCalendar(details)).toBe('added');
    expect(Calendar.requestCalendarPermissions).toHaveBeenCalledWith(true);
    expect(add).toHaveBeenCalledWith({
      title: 'Summer Night',
      startDate: details.startsAt,
      endDate: details.endsAt,
      location: 'Lakeside Pavilion',
      notes: 'General admission · Lakeside Events',
    });
  });
  it('reports a closed form as cancelled, and denied permission as denied', async () => {
    (Calendar.getDefaultCalendarSync as jest.Mock).mockReturnValueOnce({
      addEventWithForm: jest.fn(async () => ({ action: 'canceled' })),
    });
    expect(await nativeServices.addToCalendar(details)).toBe('cancelled');
    (Calendar.requestCalendarPermissions as jest.Mock).mockResolvedValueOnce({ granted: false });
    expect(await nativeServices.addToCalendar(details)).toBe('denied');
  });
  it('picks a writable calendar on Android, and reports none or a failure', async () => {
    setPlatform('android');
    const add = jest.fn(async () => ({ action: 'done' }));
    (Calendar.getCalendars as jest.Mock).mockResolvedValueOnce([
      { allowsModifications: false },
      { allowsModifications: true, addEventWithForm: add },
    ]);
    expect(await nativeServices.addToCalendar({ ...details, location: null, notes: null })).toBe('added');
    expect(add).toHaveBeenCalledWith({
      title: 'Summer Night',
      startDate: details.startsAt,
      endDate: details.endsAt,
    });
    (Calendar.getCalendars as jest.Mock).mockResolvedValueOnce([{ allowsModifications: false }]);
    expect(await nativeServices.addToCalendar(details)).toBe('unavailable');
    (Calendar.getCalendars as jest.Mock).mockRejectedValueOnce(new Error('x'));
    expect(await nativeServices.addToCalendar(details)).toBe('unavailable');
  });

  it('raises the brightness and puts the person’s own level back on iOS', async () => {
    (Brightness.getBrightnessAsync as jest.Mock).mockResolvedValueOnce(0.3);
    const restore = await nativeServices.boostBrightness();
    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(1);
    restore();
    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.3);
  });
  it('hands the brightness back to the system on Android', async () => {
    setPlatform('android');
    const restore = await nativeServices.boostBrightness();
    restore();
    expect(Brightness.restoreSystemBrightnessAsync).toHaveBeenCalled();
  });
  it('does nothing, without an error, when brightness cannot be changed', async () => {
    (Brightness.getBrightnessAsync as jest.Mock).mockRejectedValueOnce(new Error('x'));
    const restore = await nativeServices.boostBrightness();
    expect(() => restore()).not.toThrow();
  });
});
