/**
 * The phone services the shopping screens use (M7.3c), behind small interfaces so the screens and the
 * checkout flow run under Jest without a phone: the location, the secure browser session and the
 * random key. `ShopPortsProvider` swaps them in tests; the app uses the Expo ones.
 *
 * The Expo modules are loaded on first use, so a screen that never asks for the location never loads
 * (or asks for) it.
 */
import { randomUUID } from 'expo-crypto';
import { createContext, type ReactNode, useContext } from 'react';
import type { NearMe } from './filters';

export type NearMeResult =
  | { readonly status: 'granted'; readonly near: NearMe }
  /** The person said no (or can't be asked again): the screen explains how to turn it on. */
  | { readonly status: 'denied'; readonly canAskAgain: boolean }
  /** Location services are off, or the phone could not find itself. */
  | { readonly status: 'unavailable' };

export interface LocationPort {
  /** Asks only while the app is open, once per tap, and reads one position. */
  requestNearMe(): Promise<NearMeResult>;
  openSettings(): Promise<void>;
}

/** How the secure browser session ended. `return` means the page redirected to the return link. */
export type BrowserOutcome =
  | { readonly type: 'return'; readonly url: string }
  /** The person closed the sheet, or it was dismissed: how the payment went is not known. */
  | { readonly type: 'closed' };

export interface BrowserPort {
  /** The provider's hosted payment page in an auth session that ends at `returnUrl`. */
  openPayment(paymentUrl: string, returnUrl: string): Promise<BrowserOutcome>;
  /** The web checkout (or any page) in the system's secure browser. */
  openWeb(url: string): Promise<void>;
}

export interface ShopPorts {
  readonly location: LocationPort;
  readonly browser: BrowserPort;
  /** A fresh `Idempotency-Key`. */
  readonly newKey: () => string;
  readonly now: () => Date;
}

const expoLocation: LocationPort = {
  async requestNearMe() {
    const Location = await import('expo-location');
    try {
      if (!(await Location.hasServicesEnabledAsync())) return { status: 'unavailable' };
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted')
        return { status: 'denied', canAskAgain: permission.canAskAgain !== false };
      // A recent fix is plenty for "events near me" and spares the battery; fall back to a fresh read.
      const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
      const position =
        last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      return {
        status: 'granted',
        near: { lat: position.coords.latitude, lng: position.coords.longitude },
      };
    } catch {
      return { status: 'unavailable' };
    }
  },
  async openSettings() {
    const { Linking } = await import('react-native');
    await Linking.openSettings();
  },
};

const expoBrowser: BrowserPort = {
  async openPayment(paymentUrl, returnUrl) {
    const WebBrowser = await import('expo-web-browser');
    const result = await WebBrowser.openAuthSessionAsync(paymentUrl, returnUrl);
    return result.type === 'success' ? { type: 'return', url: result.url } : { type: 'closed' };
  },
  async openWeb(url) {
    const WebBrowser = await import('expo-web-browser');
    await WebBrowser.openBrowserAsync(url);
  },
};

let expoPorts: ShopPorts | undefined;
function defaultPorts(): ShopPorts {
  expoPorts ??= {
    location: expoLocation,
    browser: expoBrowser,
    newKey: () => randomUUID(),
    now: () => new Date(),
  };
  return expoPorts;
}

const PortsContext = createContext<ShopPorts | null>(null);

export function ShopPortsProvider({ ports, children }: { ports: ShopPorts; children: ReactNode }) {
  return <PortsContext.Provider value={ports}>{children}</PortsContext.Provider>;
}

export const useShopPorts = (): ShopPorts => useContext(PortsContext) ?? defaultPorts();
