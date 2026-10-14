/**
 * Renders a screen inside the app's real wiring (`createStaffServices`) with fakes for the phone:
 * memory storage, a fake `/v1` that answers the door device and a few other routes, a fixed clock
 * for the event window, and a language choice (Arabic for the right-to-left renders).
 */
import { randomBytes } from 'node:crypto';
import { act, render, screen } from '@testing-library/react-native';
import { CoreProvider, memoryFileStore, memoryKeyValueStore } from '@yayatoh/mobile-core';
import type { ReactElement } from 'react';
import { DeviceProvider } from '../../src/device';
import { catalogs } from '../../src/i18n';
import { PortalProvider } from '../../src/portal';
import { createStaffServices } from '../../src/services';
import { createFakeDoor, type FakeDoor, json } from './fake-door';

export const API = 'https://app.yayatoh.com/api/v1';
const LOCALE_KEY = 'yayatoh.pref.locale';

const built: ReturnType<typeof buildApp>[] = [];
// A running heartbeat or a cached query keeps timers alive, which would keep Jest open.
afterEach(() => {
  for (const app of built.splice(0)) {
    app.device.stopHeartbeat();
    app.core.queryClient.clear();
  }
});

export interface App extends ReturnType<typeof createStaffServices> {
  door: FakeDoor;
  storage: ReturnType<typeof memoryKeyValueStore>;
  clock: { now: number };
  /** The `/v1/mobile/config` answer: the minimum version the server wants for Staff on iOS. */
  config: { minimum: string; latest: string };
  extra: { handler: ((request: Request) => Response | Promise<Response> | undefined) | null };
}

export function buildApp(
  opts: { locale?: string; version?: string; storage?: ReturnType<typeof memoryKeyValueStore> } = {},
): App {
  const clock = { now: Date.parse('2026-10-14T12:00:00Z') };
  const door = createFakeDoor(() => clock.now);
  const config = { minimum: '0.0.0', latest: '0.0.0' };
  const extra: App['extra'] = { handler: null };
  const base = door.fetch;
  door.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (door.failNetwork) throw new TypeError('Network request failed');
    const url = new URL(request.url);
    if (url.pathname.endsWith('/mobile/config'))
      return json(200, {
        apps: {
          'yayatoh-staff-ios': {
            minimumVersion: config.minimum,
            latestVersion: config.latest,
            storeUrl: 'https://apps.apple.com/app/yayatoh-staff',
          },
        },
      });
    const handled = await extra.handler?.(request.clone());
    if (handled) return handled;
    return base(request);
  };
  const storage = opts.storage ?? memoryKeyValueStore(opts.locale ? { [LOCALE_KEY]: opts.locale } : {});
  const services = createStaffServices({
    apiBaseUrl: API,
    identity: { app: 'staff', platform: 'ios', version: opts.version ?? '1.0.0', build: '1' },
    catalogs,
    adapters: {
      storage,
      files: memoryFileStore(),
      random: (n) => new Uint8Array(randomBytes(n)),
      fetch: (input, init) => door.fetch(input, init),
    },
    battery: async () => 77,
  });
  const app = { ...services, door, storage, clock, config, extra };
  built.push(app);
  return app;
}

/** Lets pending promises (storage reads, fetches, state updates) settle. */
export const settle = () => act(async () => void (await new Promise((resolve) => setImmediate(resolve))));

export async function renderApp(ui: ReactElement, app: App = buildApp()) {
  const view = render(
    <CoreProvider bindNetwork={false} core={app.core}>
      <DeviceProvider heartbeat={false} session={app.device}>
        <PortalProvider session={app.portal}>{ui}</PortalProvider>
      </DeviceProvider>
    </CoreProvider>,
  );
  await settle();
  await settle();
  return { ...view, app };
}

/** Text that is a message key rather than a message: a key missing from a catalog shows as itself. */
export const missingMessages = (texts: readonly string[]) =>
  texts.filter((t) => /^(?:enrol|device|organizer|exhibitor|core)\.[A-Za-z_.]+$/.test(t));

/** Every piece of text on the screen, one string per `Text`. */
export const shownTexts = (): string[] =>
  screen
    .queryAllByText(/.+/)
    .map((node) =>
      [node.props.children]
        .flat(3)
        .filter((c) => typeof c === 'string')
        .join(''),
    )
    .filter(Boolean);
