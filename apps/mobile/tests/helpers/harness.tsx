import { randomBytes } from 'node:crypto';
import { render } from '@testing-library/react-native';
import {
  type Core,
  CoreProvider,
  createCore,
  memoryFileStore,
  memoryKeyValueStore,
  messagesFor,
} from '@yayatoh/mobile-core';
import type { ReactElement } from 'react';
import { catalogs } from '../../src/i18n';
import { type NearMeResult, type ShopPorts, ShopPortsProvider, type BrowserOutcome } from '../../src/shop/ports';
import { type FakeShop, createFakeShop } from './fake-shop';
import { WEB } from './fixtures';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

export interface FakePorts extends ShopPorts {
  readonly location: ShopPorts['location'] & {
    requestNearMe: jest.Mock<Promise<NearMeResult>, []>;
    openSettings: jest.Mock<Promise<void>, []>;
  };
  readonly browser: ShopPorts['browser'] & {
    openPayment: jest.Mock<Promise<BrowserOutcome>, [string, string]>;
    openWeb: jest.Mock<Promise<void>, [string]>;
    openExternal: jest.Mock<Promise<void>, [string]>;
    dismiss: jest.Mock<Promise<void>, []>;
  };
  readonly links: { resolveShortCode: jest.Mock<Promise<string | null>, [string, string]> };
  readonly keys: string[];
}

export function createFakePorts(now = new Date(2027, 4, 5, 12, 0)): FakePorts {
  let n = 0;
  const keys: string[] = [];
  return {
    keys,
    location: {
      requestNearMe: jest.fn(async (): Promise<NearMeResult> => ({
        status: 'granted',
        near: { lat: 38.722252, lng: -9.139337 },
      })),
      openSettings: jest.fn(async () => {}),
    },
    browser: {
      openPayment: jest.fn<Promise<BrowserOutcome>, [string, string]>(async () => ({ type: 'closed' })),
      openWeb: jest.fn<Promise<void>, [string]>(async () => {}),
      openExternal: jest.fn<Promise<void>, [string]>(async () => {}),
      dismiss: jest.fn<Promise<void>, []>(async () => {}),
    },
    links: {
      resolveShortCode: jest.fn<Promise<string | null>, [string, string]>(async () => 'summer-jazz'),
    },
    newKey: () => {
      n += 1;
      const key = `key-${n}`;
      keys.push(key);
      return key;
    },
    now: () => now,
    wait: async () => {},
  };
}

export const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'ada@example.test', emailVerified: true, name: 'Ada' };

export interface App {
  readonly core: Core;
  readonly shop: FakeShop;
  readonly ports: FakePorts;
}

const built: Core[] = [];
afterEach(() => {
  // A cached query keeps a garbage-collection timer that would hold Jest open.
  for (const core of built.splice(0)) core.queryClient.clear();
});

export interface RenderOptions {
  readonly locale?: keyof typeof catalogs;
  readonly signedIn?: boolean;
  readonly user?: Partial<typeof USER>;
  readonly shop?: FakeShop;
  readonly ports?: FakePorts;
}

/** Renders `ui` inside the real core (theme, language, query cache) over the fake API and fake phone services. */
export async function renderApp(ui: ReactElement, options: RenderOptions = {}) {
  const shop = options.shop ?? createFakeShop();
  const ports = options.ports ?? createFakePorts();
  const storage = memoryKeyValueStore();
  if (options.locale && options.locale !== 'en') await storage.set('yayatoh.pref.locale', options.locale);
  const core = createCore({
    appName: 'Yayatoh',
    identity: { app: 'mobile', platform: 'ios', version: '1.0.0', build: '1' },
    apiBaseUrl: `${WEB}/api/v1`,
    catalogs,
    adapters: { storage, files: memoryFileStore(), random: (n) => new Uint8Array(randomBytes(n)), fetch: shop.fetch },
  });
  built.push(core);
  core.queryClient.setDefaultOptions({
    queries: { retry: false, gcTime: Number.POSITIVE_INFINITY, staleTime: 0 },
    mutations: { retry: false },
  });
  if (options.signedIn !== false) {
    const now = Date.now();
    await core.session.setTokens({
      accessToken: 'access-1',
      tokenType: 'bearer',
      accessTokenExpiresAt: new Date(now + 15 * 60_000).toISOString(),
      refreshToken: 'refresh-1',
      refreshTokenExpiresAt: new Date(now + 30 * 86_400_000).toISOString(),
      user: { ...USER, ...options.user },
    });
  }
  const view = render(
    <CoreProvider core={core} bindNetwork={false}>
      <ShopPortsProvider ports={ports}>{ui}</ShopPortsProvider>
    </CoreProvider>,
  );
  const app: App = { core, shop, ports };
  return { ...view, ...app };
}

export const t = (locale: keyof typeof catalogs, path: string): string => {
  const value = path
    .split('.')
    .reduce<unknown>((tree, key) => (tree as Record<string, unknown> | undefined)?.[key], messagesFor(catalogs, locale));
  if (typeof value !== 'string') throw new Error(`No string at ${path} in ${locale}`);
  return value;
};
