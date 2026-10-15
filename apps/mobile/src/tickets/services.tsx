/**
 * The phone services the Tickets screens use (M7.3b), behind one small interface each so the
 * screens run under Jest without a device: screen brightness, the calendar, the maps app, the
 * secure browser session and the wallet link. `nativeServices` is the Expo adapter; tests pass
 * their own through `TicketServicesProvider`.
 */
import * as Brightness from 'expo-brightness';
import * as Calendar from 'expo-calendar';
import * as WebBrowser from 'expo-web-browser';
import { createContext, type ReactNode, useContext } from 'react';
import { Linking, Platform } from 'react-native';

export interface CalendarEventDetails {
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly location: string | null;
  readonly notes: string | null;
}

/** `added`: the person saved it in the system form. `cancelled`: they closed the form. */
export type CalendarOutcome = 'added' | 'cancelled' | 'denied' | 'unavailable';

export interface TicketServices {
  /** Turns the screen to full brightness; the returned function puts it back. */
  boostBrightness(): Promise<() => void>;
  addToCalendar(event: CalendarEventDetails): Promise<CalendarOutcome>;
  /** Opens a maps app at an address or coordinates. False when nothing could open it. */
  openMaps(target: MapsTarget): Promise<boolean>;
  /** Opens a web page in the system's secure browser session (Safari view / Custom Tabs). */
  openWeb(url: string): Promise<void>;
  /** Opens a wallet pass link (the system hands `.pkpass` to Wallet and the Google link to its app). */
  openWalletLink(url: string): Promise<boolean>;
  now(): Date;
}

export interface MapsTarget {
  readonly label: string;
  readonly address: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** The venue's own map link, tried first when it is a plain https link. */
  readonly mapUrl: string | null;
}

/** The URLs a maps app opens, in the order to try them. Pure, so it is unit tested. */
export function mapsUrls(target: MapsTarget, platform: 'ios' | 'android' | string): string[] {
  const urls: string[] = [];
  if (target.mapUrl && /^https:\/\/[^\s]+$/i.test(target.mapUrl)) urls.push(target.mapUrl);
  const hasPoint = target.latitude !== null && target.longitude !== null;
  const place = encodeURIComponent(target.address ? `${target.label}, ${target.address}` : target.label);
  if (platform === 'ios') {
    urls.push(
      hasPoint
        ? `https://maps.apple.com/?ll=${target.latitude},${target.longitude}&q=${encodeURIComponent(target.label)}`
        : `https://maps.apple.com/?q=${place}`,
    );
  } else {
    urls.push(
      hasPoint
        ? `geo:${target.latitude},${target.longitude}?q=${target.latitude},${target.longitude}(${encodeURIComponent(target.label)})`
        : `geo:0,0?q=${place}`,
    );
  }
  urls.push(
    `https://www.google.com/maps/search/?api=1&query=${
      hasPoint ? `${target.latitude},${target.longitude}` : place
    }`,
  );
  return urls;
}

export const nativeServices: TicketServices = {
  async boostBrightness() {
    try {
      const before = await Brightness.getBrightnessAsync();
      await Brightness.setBrightnessAsync(1);
      return () => {
        // iOS keeps the value until the phone locks, so put the person's own level back; Android's
        // per-window override is dropped in favour of the system level.
        const restore =
          Platform.OS === 'android'
            ? Brightness.restoreSystemBrightnessAsync()
            : Brightness.setBrightnessAsync(before);
        restore.catch(() => {});
      };
    } catch {
      return () => {};
    }
  },
  async addToCalendar(event) {
    try {
      // Write-only on iOS 17+: the app can add this one event and never reads the calendar.
      const permission = await Calendar.requestCalendarPermissions(true);
      if (!permission.granted) return 'denied';
      const target =
        Platform.OS === 'ios'
          ? Calendar.getDefaultCalendarSync()
          : (await Calendar.getCalendars()).find((c) => c.allowsModifications);
      if (!target) return 'unavailable';
      const result = await target.addEventWithForm({
        title: event.title,
        startDate: event.startsAt,
        endDate: event.endsAt,
        ...(event.location ? { location: event.location } : {}),
        ...(event.notes ? { notes: event.notes } : {}),
      });
      return result.action === 'saved' || result.action === 'done' ? 'added' : 'cancelled';
    } catch {
      return 'unavailable';
    }
  },
  async openMaps(target) {
    for (const url of mapsUrls(target, Platform.OS)) {
      try {
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url);
          return true;
        }
      } catch {
        // Try the next one.
      }
    }
    return false;
  },
  async openWeb(url) {
    await WebBrowser.openBrowserAsync(url);
  },
  async openWalletLink(url) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  },
  now: () => new Date(),
};

const ServicesContext = createContext<TicketServices>(nativeServices);

export function TicketServicesProvider({
  services,
  children,
}: {
  services: TicketServices;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export const useTicketServices = (): TicketServices => useContext(ServicesContext);
