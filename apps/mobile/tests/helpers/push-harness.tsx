/**
 * Test harness for the push and link tests (M7.3d): a fake `PushPort` the test drives, a fake `/v1`
 * that records calls, a real `Core` over memory storage, and a router with the app's real shell
 * (`CoreProvider` + `PushProvider`) around stub screens.
 */
import { randomBytes } from 'node:crypto';
import { CoreProvider, createCore, memoryFileStore, memoryKeyValueStore } from '@yayatoh/mobile-core';
import type { Schemas } from '@yayatoh/sdk';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import NotificationSettings from '../../src/app/account/notifications';
import { catalogs } from '../../src/i18n';
import type { DevicePushToken, IncomingPush, PushPermission, PushPort } from '../../src/push/port';
import type { PreferencesPort } from '../../src/push/preferences';
import { PushProvider } from '../../src/push/provider';
import type { DeviceFacts } from '../../src/push/registration';

export const USER: Schemas['User'] = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ada@example.test',
  emailVerified: true,
  name: 'Ada',
};

export { ORDER_ID, push, TICKET_ID } from './push-ids';

export function pair(n = 0) {
  return {
    accessToken: `access-${n}`,
    tokenType: 'bearer',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    refreshToken: `refresh-${n}`,
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: USER,
  } as Schemas['TokenPair'];
}

export interface FakePort extends PushPort {
  permission: PushPermission;
  /** What the phone's sheet answers when asked. */
  sheetAnswer: PushPermission;
  token: DevicePushToken | null;
  launch: IncomingPush | null;
  requested: number;
  settingsOpened: number;
  channelName: string | null;
  emitTap(push: IncomingPush): void;
  emitForeground(push: IncomingPush): void;
  emitToken(token: DevicePushToken): void;
}

export function fakePort(
  initial: Partial<Pick<FakePort, 'permission' | 'token' | 'launch' | 'sheetAnswer'>> = {},
): FakePort {
  const taps = new Set<(p: IncomingPush) => void>();
  const foreground = new Set<(p: IncomingPush) => void>();
  const tokens = new Set<(t: DevicePushToken) => void>();
  const port: FakePort = {
    permission: initial.permission ?? 'undetermined',
    sheetAnswer: initial.sheetAnswer ?? 'granted',
    token:
      initial.token === undefined ? { platform: 'fcm', token: 'fcm-token-aaaaaaaaaaaaaaaa' } : initial.token,
    launch: initial.launch ?? null,
    requested: 0,
    settingsOpened: 0,
    channelName: null,
    setChannelName(name) {
      port.channelName = name;
    },
    async getPermission() {
      return port.permission;
    },
    async requestPermission() {
      port.requested += 1;
      port.permission = port.sheetAnswer;
      return port.permission;
    },
    async getDeviceToken() {
      return port.permission === 'granted' ? port.token : null;
    },
    onTokenChange(l) {
      tokens.add(l);
      return () => tokens.delete(l);
    },
    onForeground(l) {
      foreground.add(l);
      return () => foreground.delete(l);
    },
    onTap(l) {
      taps.add(l);
      return () => taps.delete(l);
    },
    async takeLaunchPush() {
      const p = port.launch;
      port.launch = null;
      return p;
    },
    async openSystemSettings() {
      port.settingsOpened += 1;
    },
    emitTap(p) {
      for (const l of taps) l(p);
    },
    emitForeground(p) {
      for (const l of foreground) l(p);
    },
    emitToken(t) {
      for (const l of tokens) l(t);
    },
  };
  return port;
}

export interface FakeCall {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

export interface FakeServer {
  fetch: typeof globalThis.fetch;
  calls: FakeCall[];
  /** `organizations` the registration answers with. */
  organizations: number;
  failDevices: boolean;
  offline: boolean;
}

export function fakeServer(): FakeServer {
  const server: FakeServer = {
    calls: [],
    organizations: 1,
    failDevices: false,
    offline: false,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (server.offline) throw new TypeError('offline');
      const url = new URL(request.url);
      const path = url.pathname.replace(/^.*?(\/v1\/)/, '/v1/');
      const raw = request.method === 'GET' ? '' : await request.clone().text();
      server.calls.push({
        method: request.method,
        path,
        authorization: request.headers.get('authorization'),
        body: raw ? JSON.parse(raw) : undefined,
      });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (path === '/v1/me/devices' && request.method === 'POST') {
        if (server.failDevices) return json(500, { type: 'x', title: 'x', status: 500, code: 'internal' });
        return json(200, { organizations: server.organizations });
      }
      if (path.startsWith('/v1/me/devices/') && request.method === 'DELETE')
        return new Response(null, { status: 204 });
      if (path === '/v1/auth/revoke') return new Response(null, { status: 204 });
      return json(404, { type: 'x', title: 'x', status: 404, code: 'not_found' });
    },
  };
  return server;
}

export function buildCore(server: FakeServer = fakeServer(), initial: Record<string, string> = {}) {
  const storage = memoryKeyValueStore(initial);
  const core = createCore({
    appName: 'Yayatoh',
    identity: { app: 'mobile', platform: 'ios', version: '1.2.3', build: '7' },
    apiBaseUrl: 'https://app.yayatoh.com/api/v1',
    catalogs,
    adapters: {
      storage,
      files: memoryFileStore(),
      random: (n) => new Uint8Array(randomBytes(n)),
      fetch: server.fetch,
    },
  });
  return { core, storage, server };
}

export const DEVICE: DeviceFacts = {
  appId: 'com.yayatoh.yayatohapp',
  appVersion: '1.2.3',
  environment: 'production',
};

const stub = (name: string) =>
  function Stub() {
    return <Text testID="screen">{name}</Text>;
  };

export interface Harness {
  core: ReturnType<typeof buildCore>['core'];
  storage: ReturnType<typeof buildCore>['storage'];
  server: FakeServer;
  port: FakePort;
  view: ReturnType<typeof renderRouter>;
}

/**
 * The app's shell around stub screens. Every route a link or push can open has a stub that shows
 * its own name, so a test can say "the ticket screen is showing".
 */
export function renderApp(
  options: {
    initialUrl?: string;
    port?: FakePort;
    signedIn?: boolean;
    preferences?: PreferencesPort;
    server?: FakeServer;
    /** The in-app language (`ar` for the right-to-left render). */
    locale?: string;
  } = {},
): Harness {
  const { core, storage, server } = buildCore(
    options.server,
    options.locale ? { 'yayatoh.pref.locale': options.locale } : {},
  );
  const port = options.port ?? fakePort();
  if (options.signedIn !== false) void core.session.setTokens(pair());

  function Layout() {
    return (
      <CoreProvider core={core} bindNetwork={false}>
        <PushProvider port={port} device={DEVICE} preferences={options.preferences}>
          <Slot />
        </PushProvider>
      </CoreProvider>
    );
  }
  const view = renderRouter(
    {
      _layout: Layout,
      index: stub('home'),
      'tickets/[id]': stub('ticket'),
      'tickets/link/[token]': stub('ticket-link'),
      'orders/[id]': stub('order'),
      'orders/link/[token]': stub('order-link'),
      'events/[slug]': stub('event'),
      'e/[code]': stub('event-short'),
      'claim/[token]': stub('claim'),
      'account/notifications': NotificationSettings,
    },
    { initialUrl: options.initialUrl ?? '/' },
  );
  return { core, storage, server, port, view };
}
