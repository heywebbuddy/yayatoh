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
  /** A link that belongs to another app (maps), opened by the system. */
  openExternal(url: string): Promise<void>;
  /** Closes a browser session still open (the app was reopened by the return link). */
  dismiss(): Promise<void>;
}

export interface LinksPort {
  /**
   * The slug a short code (`/e/{code}`) points to, or null when no event has that code. The web
   * answers the short link with a permanent redirect to the event page; there is no `/v1` route for
   * it yet, so the app follows that redirect and reads the slug from where it ends.
   */
  resolveShortCode(webBase: string, code: string): Promise<string | null>;
}

export interface ShopPorts {
  readonly location: LocationPort;
  readonly links: LinksPort;
  readonly browser: BrowserPort;
  /** A fresh `Idempotency-Key`. */
  readonly newKey: () => string;
  readonly now: () => Date;
  /** Waits; the checkout re-reads an order a few times while the provider confirms a payment. */
  readonly wait: (ms: number) => Promise<void>;
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
    try {
      const result = await WebBrowser.openAuthSessionAsync(paymentUrl, returnUrl);
      return result.type === 'success' ? { type: 'return', url: result.url } : { type: 'closed' };
    } catch {
      // An auth session can refuse a return link it cannot watch for (an https link on an older iOS):
      // the plain secure browser still shows the payment page, and the return link reopens the app.
      await WebBrowser.openBrowserAsync(paymentUrl);
      return { type: 'closed' };
    }
  },
  async openExternal(url) {
    const { Linking } = await import('react-native');
    await Linking.openURL(url);
  },
  async dismiss() {
    const WebBrowser = await import('expo-web-browser');
    try {
      WebBrowser.dismissAuthSession();
      WebBrowser.dismissBrowser();
    } catch {
      // Nothing was open.
    }
  },
  async openWeb(url) {
    const WebBrowser = await import('expo-web-browser');
    await WebBrowser.openBrowserAsync(url);
  },
};

const expoLinks: LinksPort = {
  async resolveShortCode(webBase, code) {
    const response = await fetch(`${webBase.replace(/\/+$/, '')}/e/${encodeURIComponent(code)}`, {
      method: 'HEAD',
      redirect: 'follow',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`short link: ${response.status}`);
    return /\/events\/([A-Za-z0-9][A-Za-z0-9_-]{0,199})(?:[/?#]|$)/.exec(response.url)?.[1] ?? null;
  },
};

let expoPorts: ShopPorts | undefined;
function defaultPorts(): ShopPorts {
  expoPorts ??= {
    location: expoLocation,
    browser: expoBrowser,
    links: expoLinks,
    newKey: () => randomUUID(),
    now: () => new Date(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  return expoPorts;
}

const PortsContext = createContext<ShopPorts | null>(null);

export function ShopPortsProvider({ ports, children }: { ports: ShopPorts; children: ReactNode }) {
  return <PortsContext.Provider value={ports}>{children}</PortsContext.Provider>;
}

export const useShopPorts = (): ShopPorts => useContext(PortsContext) ?? defaultPorts();
