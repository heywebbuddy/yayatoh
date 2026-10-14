import { randomBytes } from 'node:crypto';
import { onlineManager } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import {
  type AppLocale,
  type Core,
  CoreProvider,
  createCore,
  memoryFileStore,
  memoryKeyValueStore,
} from '@yayatoh/mobile-core';
import type { ReactElement } from 'react';
import { catalogs } from '../../src/i18n';
import { type TicketServices, TicketServicesProvider } from '../../src/tickets/services';
import { createServer, pair } from './server';

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Services that do nothing and record what they were asked, so a test can drive them. */
export function fakeServices(over: Partial<TicketServices> = {}) {
  const log = {
    brightness: [] as string[],
    calendar: [] as unknown[],
    maps: [] as unknown[],
    web: [] as string[],
    wallet: [] as string[],
  };
  const services: TicketServices = {
    boostBrightness: jest.fn(async () => {
      log.brightness.push('full');
      return () => {
        log.brightness.push('restored');
      };
    }),
    addToCalendar: jest.fn(async (event) => {
      log.calendar.push(event);
      return 'added' as const;
    }),
    openMaps: jest.fn(async (target) => {
      log.maps.push(target);
      return true;
    }),
    openWeb: jest.fn(async (url) => {
      log.web.push(url);
    }),
    openWalletLink: jest.fn(async (url) => {
      log.wallet.push(url);
      return true;
    }),
    now: () => new Date('2030-02-01T12:00:00Z'),
    ...over,
  };
  return { services, log };
}

export interface AppOptions {
  readonly locale?: AppLocale;
  readonly signedIn?: boolean;
  readonly services?: TicketServices;
  /** A second launch of the same phone: its keychain and files. */
  readonly phone?: {
    storage: ReturnType<typeof memoryKeyValueStore>;
    files: ReturnType<typeof memoryFileStore>;
  };
}

export function setup(options: AppOptions = {}) {
  const server = createServer();
  const storage = options.phone?.storage ?? memoryKeyValueStore();
  const files = options.phone?.files ?? memoryFileStore();
  const core: Core = createCore({
    appName: 'Yayatoh',
    identity: { app: 'mobile', platform: 'ios', version: '1.0.0', build: '1' },
    apiBaseUrl: 'https://app.yayatoh.test/api/v1',
    catalogs,
    adapters: { storage, files, random: (n) => new Uint8Array(randomBytes(n)), fetch: server.fetch },
  });
  const locale = options.locale ?? 'en';
  const fake = fakeServices();
  const services = options.services ?? fake.services;
  const ready = (async () => {
    if (options.locale) await storage.set('yayatoh.pref.locale', locale);
    if (options.signedIn === false || options.phone) await core.session.restore();
    else {
      await core.session.setTokens(pair(0));
      await core.session.restore();
    }
  })();
  const view = (ui: ReactElement) =>
    render(
      <CoreProvider core={core} bindNetwork={false}>
        <TicketServicesProvider services={services}>{ui}</TicketServicesProvider>
      </CoreProvider>,
    );
  return { core, server, storage, files, services, log: fake.log, ready, view };
}

/** Makes Query and the offline check agree the phone has no connection (or has it back). */
export function setOnline(online: boolean) {
  onlineManager.setOnline(online);
}
