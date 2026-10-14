import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { type AppLocale, LocaleProvider, ThemeProvider } from '@yayatoh/mobile-core';
import { type ReactElement, useSyncExternalStore } from 'react';
import { catalogs } from '../../src/i18n';
import { ToolsProvider, type ToolsDeps } from '../../src/tools/deps';
import { CHECKPOINT, DEVICE, EVENT, fakeStaff, newId, testVault } from './fixtures';

export function makeDeps(over: Partial<ToolsDeps> = {}): ToolsDeps & { vaultFiles: Map<string, Uint8Array> } {
  const t = testVault();
  return {
    device: { deviceId: DEVICE, eventId: EVENT, checkpointId: CHECKPOINT },
    staff: fakeStaff(),
    portal: null,
    organizer: null,
    manifest: async () => null,
    offlineCheckIn: null,
    vault: t.vault,
    vaultFiles: t.files.files,
    push: {
      permission: async () => 'granted',
      request: async () => 'granted',
      token: async () => ({ platform: 'fcm', token: 'fcm-token-12345', appId: 'com.yayatoh.staff' }),
    },
    Scanner: null,
    clock: { now: () => new Date('2026-10-20T10:00:00Z'), offsetMs: () => 0 },
    newId,
    navigate: jest.fn(),
    useOffline: () => false,
    ...over,
  };
}

const clients: QueryClient[] = [];
// A query's garbage-collection timer would keep Jest alive for its whole `gcTime`.
afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
});

export function renderTool(ui: ReactElement, opts: { deps?: ToolsDeps; locale?: AppLocale } = {}) {
  const locale = opts.locale ?? 'en';
  const deps = opts.deps ?? makeDeps();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <LocaleProvider
          catalogs={catalogs}
          deviceLanguageTags={[locale]}
          direction={{ isRTL: locale === 'ar', allowRTL: () => {}, forceRTL: () => {}, reload: async () => {} }}
        >
          <ToolsProvider deps={deps}>{ui}</ToolsProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, client, deps };
}

export const en = catalogs.en;

/** A connection switch for tests: `useOffline` follows `set(offline)` and re-renders the screen. */
export function offlineSwitch(initial = false) {
  let offline = initial;
  const listeners = new Set<() => void>();
  return {
    useOffline: () =>
      useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => offline,
      ),
    set(next: boolean) {
      offline = next;
      for (const l of listeners) l();
    },
  };
}
