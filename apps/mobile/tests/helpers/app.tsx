/**
 * Renders the attendee app's real routes (the `(auth)`, `(tabs)` and `account` folders and the
 * index) inside Expo Router's test renderer, over a real `Core` with in-memory storage and the fake
 * `/v1` (M7.3a). Only the root layout is the test's own: the real one builds the native core.
 */
import { randomBytes } from 'node:crypto';
import {
  type AppleSignInProvider,
  type Core,
  CoreProvider,
  createCore,
  type GoogleSignInProvider,
  memoryFileStore,
  memoryKeyValueStore,
} from '@yayatoh/mobile-core';
import { Slot } from 'expo-router';
import { act, renderRouter } from 'expo-router/testing-library';
import type { ComponentType } from 'react';
import { Text } from 'react-native';
import AuthLayout from '../../src/app/(auth)/_layout';
import CodeScreen from '../../src/app/(auth)/code';
import EmailScreen from '../../src/app/(auth)/email';
import LinkProofScreen from '../../src/app/(auth)/link-proof';
import PasswordScreen from '../../src/app/(auth)/password';
import TwoFactorScreen from '../../src/app/(auth)/two-factor';
import Welcome from '../../src/app/(auth)/welcome';
import TabsLayout from '../../src/app/(tabs)/_layout';
import AccountTab from '../../src/app/(tabs)/account';
import DiscoverTab from '../../src/app/(tabs)/discover';
import TicketsTab from '../../src/app/(tabs)/tickets';
import AccountLayout from '../../src/app/account/_layout';
import DeleteAccount from '../../src/app/account/delete';
import AccountDeleted from '../../src/app/account/deleted';
import LanguageScreen from '../../src/app/account/language';
import Index from '../../src/app/index';
import { catalogs } from '../../src/i18n';
import { createFakeServer, type FakeServer, pair } from './fake-server';

export interface Harness {
  readonly core: Core;
  readonly server: FakeServer;
  readonly storage: ReturnType<typeof memoryKeyValueStore>;
  readonly files: ReturnType<typeof memoryFileStore>;
  readonly view: ReturnType<typeof renderRouter>;
}

export const fakeApple: AppleSignInProvider = {
  isAvailable: async () => true,
  signIn: async () => ({ idToken: 'apple-ok', name: 'Ada' }),
};
export const fakeGoogle: GoogleSignInProvider = { signIn: async () => ({ idToken: 'google-ok' }) };

const NotificationsPlaceholder = () => <Text>notifications placeholder</Text>;

export interface RenderOptions {
  readonly url?: string;
  readonly signedIn?: boolean;
  readonly server?: FakeServer;
  readonly deviceLanguage?: string;
  readonly apple?: AppleSignInProvider;
  readonly google?: GoogleSignInProvider;
}

/** Test cores keep timers; the caller clears them after each test. */
export const cores: Core[] = [];

export async function renderApp(options: RenderOptions = {}): Promise<Harness> {
  const server = options.server ?? createFakeServer();
  const storage = memoryKeyValueStore();
  const files = memoryFileStore();
  const core = createCore({
    appName: 'Yayatoh',
    identity: { app: 'mobile', platform: 'ios', version: '1.0.0', build: '7' },
    apiBaseUrl: 'https://app.yayatoh.com/api/v1',
    catalogs,
    adapters: {
      storage,
      files,
      random: (n) => new Uint8Array(randomBytes(n)),
      fetch: server.fetch,
      apple: options.apple ?? fakeApple,
      google: options.google ?? fakeGoogle,
    },
  });
  cores.push(core);
  if (options.signedIn) await core.session.setTokens(pair());

  const Root: ComponentType = () => (
    <CoreProvider core={core} bindNetwork={false}>
      <Slot />
    </CoreProvider>
  );
  const view = renderRouter(
    {
      _layout: Root,
      index: Index,
      '(auth)/_layout': AuthLayout,
      '(auth)/welcome': Welcome,
      '(auth)/email': EmailScreen,
      '(auth)/code': CodeScreen,
      '(auth)/password': PasswordScreen,
      '(auth)/two-factor': TwoFactorScreen,
      '(auth)/link-proof': LinkProofScreen,
      '(tabs)/_layout': TabsLayout,
      '(tabs)/tickets': TicketsTab,
      '(tabs)/discover': DiscoverTab,
      '(tabs)/account': AccountTab,
      'account/_layout': AccountLayout,
      'account/language': LanguageScreen,
      'account/delete': DeleteAccount,
      'account/deleted': AccountDeleted,
      'account/notifications': NotificationsPlaceholder,
    },
    { initialUrl: options.url ?? '/' },
  );
  // Let the stored session load inside act so the first screen settles before the test looks.
  await act(async () => {
    await core.session.restore();
  });
  return { core, server, storage, files, view };
}
