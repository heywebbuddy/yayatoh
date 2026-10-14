import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createYayatohClient } from '@yayatoh/sdk';
import { Text } from 'react-native';
import { createApiClient } from '../src/client';
import { LocaleProvider } from '../src/i18n/provider';
import { ThemeProvider } from '../src/theme/provider';
import { compareVersions, createVersionGate, evaluateVersion, safeStoreUrl } from '../src/version/gate';
import { SoftUpdateBanner, UpdateScreen, VersionGateView } from '../src/version/components';
import { json, problem } from './helpers/fake-api';

const IOS_STORE = 'https://apps.apple.com/app/yayatoh/id111';
const policy = (minimumVersion: string, latestVersion = minimumVersion, storeUrl = IOS_STORE) => ({
  minimumVersion,
  latestVersion,
  storeUrl,
});

const config = (apps: Record<string, ReturnType<typeof policy>>) =>
  json(200, {
    apiVersion: '1',
    minimumVersions: { ios: '0.0.0', android: '0.0.0' },
    latestVersions: { ios: '0.0.0', android: '0.0.0' },
    baseUrls: { api: 'x', web: 'y' },
    features: {},
    apps: {
      'yayatoh-ios': policy('0.0.0'),
      'yayatoh-android': policy('0.0.0'),
      'yayatoh-staff-ios': policy('0.0.0'),
      'yayatoh-staff-android': policy('0.0.0'),
      ...apps,
    },
  });

const apiFor = (fetchImpl: () => Response | Promise<Response>) =>
  createYayatohClient({ baseUrl: 'https://x.test/api', fetch: (async () => fetchImpl()) as unknown as typeof fetch });

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.1', '1.0.0', 1],
    ['3.10.0', '3.9.1', 1],
    ['3.9', '3.9.0', 0],
    ['2', '10', -1],
    ['1.2.3-beta.1', '1.2.3', 0],
    ['1.2.3+45', '1.2.3', 0],
  ])('%s vs %s', (a, b, expected) => expect(compareVersions(a, b)).toBe(expected));
});

describe('evaluateVersion', () => {
  it('is required below the minimum, recommended below the latest, else ok', () => {
    expect(evaluateVersion('1.0.0', policy('2.0.0', '2.1.0'))).toEqual({ kind: 'required', minimum: '2.0.0', latest: '2.1.0', storeUrl: IOS_STORE });
    expect(evaluateVersion('2.0.0', policy('2.0.0', '2.1.0'))).toEqual({ kind: 'recommended', latest: '2.1.0', storeUrl: IOS_STORE });
    expect(evaluateVersion('2.1.0', policy('2.0.0', '2.1.0'))).toEqual({ kind: 'ok' });
    expect(evaluateVersion('9.9.9', policy('2.0.0', '2.1.0'))).toEqual({ kind: 'ok' });
  });
  it('is unknown without a policy', () => {
    expect(evaluateVersion('1.0.0', undefined)).toEqual({ kind: 'unknown' });
  });
  it('only passes on an https store link', () => {
    expect(safeStoreUrl(IOS_STORE)).toBe(IOS_STORE);
    for (const bad of ['http://x.test', 'javascript:alert(1)', 'itms-apps://x', '', null, undefined, 'https://a b'])
      expect(safeStoreUrl(bad as string)).toBeNull();
    expect(evaluateVersion('1.0.0', policy('2.0.0', '2.0.0', 'javascript:alert(1)'))).toMatchObject({ kind: 'required', storeUrl: null });
  });
});

describe('version gate', () => {
  it('a below-minimum /v1/mobile/config blocks, with this app’s store link', async () => {
    const gate = createVersionGate({
      api: apiFor(() => config({ 'yayatoh-ios': policy('2.0.0', '2.0.0', IOS_STORE), 'yayatoh-android': policy('9.9.9', '9.9.9', 'https://play.google.com/x') })),
      client: 'yayatoh-ios',
      appVersion: '1.9.0',
    });
    expect(gate.state.kind).toBe('unknown');
    expect(await gate.check()).toEqual({ kind: 'required', minimum: '2.0.0', latest: '2.0.0', storeUrl: IOS_STORE });
  });

  it('reads the Staff app’s own entry, not the attendee one', async () => {
    const gate = createVersionGate({
      api: apiFor(() => config({ 'yayatoh-ios': policy('9.0.0'), 'yayatoh-staff-ios': policy('1.0.0') })),
      client: 'yayatoh-staff-ios',
      appVersion: '1.0.0',
    });
    expect((await gate.check()).kind).toBe('ok');
  });

  it('a Staff device in its event window is never blocked, only nudged', async () => {
    const gate = createVersionGate({
      api: apiFor(() => config({ 'yayatoh-staff-android': policy('3.0.0', '3.1.0', 'https://play.google.com/x') })),
      client: 'yayatoh-staff-android',
      appVersion: '2.0.0',
      suppressRequired: () => true,
    });
    expect(await gate.check()).toEqual({ kind: 'recommended', latest: '3.1.0', storeUrl: 'https://play.google.com/x' });
    await gate.upgradeRequired({ minimumVersion: '3.0.0', latestVersion: '3.1.0', storeUrl: 'https://play.google.com/x' });
    expect(gate.state.kind).toBe('recommended');
  });

  it.each([
    ['offline', () => Promise.reject(new TypeError('Network request failed'))],
    ['a 503', () => problem(503, 'internal')],
    ['an unreadable body', () => new Response('<html>', { status: 200 })],
  ])('%s never blocks', async (_n, answer) => {
    const gate = createVersionGate({ api: apiFor(answer as never), client: 'yayatoh-ios', appVersion: '1.0.0' });
    expect((await gate.check()).kind).toBe('unknown');
  });

  it('a later good answer does not lift a block set by a 426 unless it says the version is fine', async () => {
    const gate = createVersionGate({ api: apiFor(() => problem(503, 'internal')), client: 'yayatoh-ios', appVersion: '1.0.0' });
    await gate.upgradeRequired({ minimumVersion: '2.0.0', latestVersion: null, storeUrl: IOS_STORE });
    expect(gate.state.kind).toBe('required');
    await gate.check(); // a failed check changes nothing
    expect(gate.state.kind).toBe('required');
  });

  it('notifies subscribers', async () => {
    const gate = createVersionGate({ api: apiFor(() => config({})), client: 'yayatoh-ios', appVersion: '1.0.0' });
    const seen: string[] = [];
    gate.subscribe(() => seen.push(gate.state.kind));
    await gate.check();
    await gate.upgradeRequired({ minimumVersion: '2.0.0', latestVersion: null, storeUrl: null });
    expect(seen).toEqual(['ok', 'required']);
  });
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LocaleProvider
        catalogs={{}}
        deviceLanguageTags={['en-US']}
        direction={{ isRTL: false, allowRTL: () => {}, forceRTL: () => {}, reload: async () => {} }}
      >
        {children}
      </LocaleProvider>
    </ThemeProvider>
  );
}

describe('update screen', () => {
  it('names the version, labels the button and opens the store link', () => {
    const openUrl = jest.fn(async () => {});
    render(
      <Shell>
        <UpdateScreen appName="Yayatoh" minimumVersion="2.0.0" storeUrl={IOS_STORE} openUrl={openUrl} />
      </Shell>,
    );
    expect(screen.getByRole('header', { name: 'Update required' })).toBeOnTheScreen();
    expect(screen.getByText(/version 2\.0\.0 or later/)).toBeOnTheScreen();
    const button = screen.getByRole('button', { name: 'Update Yayatoh' });
    fireEvent.press(button);
    expect(openUrl).toHaveBeenCalledWith(IOS_STORE);
  });

  it('without a link it says to open the store, and has no button', () => {
    render(
      <Shell>
        <UpdateScreen appName="Yayatoh" minimumVersion={null} storeUrl={null} />
      </Shell>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('update-no-link')).toBeOnTheScreen();
    expect(screen.getByText(/latest version to keep going/)).toBeOnTheScreen();
  });

  it('renders in Arabic with labels, right to left', () => {
    render(
      <ThemeProvider>
        <LocaleProvider
          catalogs={{}}
          deviceLanguageTags={['ar-SA']}
          direction={{ isRTL: true, allowRTL: () => {}, forceRTL: () => {}, reload: async () => {} }}
        >
          <UpdateScreen appName="Yayatoh" minimumVersion="2.0.0" storeUrl={IOS_STORE} />
        </LocaleProvider>
      </ThemeProvider>,
    );
    expect(screen.getByRole('header', { name: 'التحديث مطلوب' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'تحديث Yayatoh' })).toBeOnTheScreen();
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
  });

  it('the button is at least 44 points tall', () => {
    render(
      <Shell>
        <UpdateScreen appName="Yayatoh" minimumVersion="2.0.0" storeUrl={IOS_STORE} />
      </Shell>,
    );
    expect(screen.getByTestId('update-button')).toHaveStyle({ minHeight: 44 });
  });
});

describe('VersionGateView', () => {
  it('a 426 from the API shows the update screen with the link the server sent', async () => {
    const appStore = 'https://apps.apple.com/app/yayatoh/id222';
    let gate!: ReturnType<typeof createVersionGate>;
    const api = createApiClient({
      baseUrl: 'https://x.test/api/v1',
      identity: { app: 'mobile', platform: 'ios', version: '1.0.0' },
      fetch: (async () => problem(426, 'upgrade_required', { minimumVersion: '2.0.0', latestVersion: '2.2.0', storeUrl: appStore })) as unknown as typeof fetch,
      onUpgradeRequired: (info) => void gate.upgradeRequired(info),
    });
    gate = createVersionGate({ api, client: 'yayatoh-ios', appVersion: '1.0.0' });
    const openUrl = jest.fn(async () => {});

    render(
      <Shell>
        <VersionGateView gate={gate} appName="Yayatoh" openUrl={openUrl}>
          <Text testID="app">the app</Text>
        </VersionGateView>
      </Shell>,
    );
    expect(screen.getByTestId('app')).toBeOnTheScreen();

    await act(async () => {
      await api.GET('/v1/me');
    });
    await waitFor(() => expect(screen.getByTestId('update-screen')).toBeOnTheScreen());
    expect(screen.queryByTestId('app')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Update Yayatoh' }));
    expect(openUrl).toHaveBeenCalledWith(appStore);
  });

  it('a newer version shows a nudge that can be dismissed, and the app stays usable', async () => {
    const gate = createVersionGate({
      api: apiFor(() => config({ 'yayatoh-ios': policy('1.0.0', '1.5.0') })),
      client: 'yayatoh-ios',
      appVersion: '1.2.0',
    });
    const openUrl = jest.fn(async () => {});
    render(
      <Shell>
        <VersionGateView gate={gate} appName="Yayatoh" openUrl={openUrl}>
          <Text testID="app">the app</Text>
        </VersionGateView>
      </Shell>,
    );
    expect(screen.queryByTestId('soft-update')).toBeNull();
    await act(async () => {
      await gate.check();
    });
    expect(screen.getByTestId('soft-update')).toBeOnTheScreen();
    expect(screen.getByText(/Version 1\.5\.0 of Yayatoh is ready/)).toBeOnTheScreen();
    expect(screen.getByTestId('app')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Update' }));
    expect(openUrl).toHaveBeenCalledWith(IOS_STORE);
    fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('soft-update')).toBeNull();
    expect(screen.getByTestId('app')).toBeOnTheScreen();
  });

  it('a version that is current shows no banner and no screen', async () => {
    const gate = createVersionGate({
      api: apiFor(() => config({ 'yayatoh-ios': policy('1.0.0', '1.2.0') })),
      client: 'yayatoh-ios',
      appVersion: '1.2.0',
    });
    render(
      <Shell>
        <VersionGateView gate={gate} appName="Yayatoh">
          <Text testID="app">the app</Text>
        </VersionGateView>
      </Shell>,
    );
    await act(async () => {
      await gate.check();
    });
    expect(screen.queryByTestId('soft-update')).toBeNull();
    expect(screen.queryByTestId('update-screen')).toBeNull();
    expect(screen.getByTestId('app')).toBeOnTheScreen();
  });

  it('the soft banner without a store link has only the dismiss button', () => {
    render(
      <Shell>
        <SoftUpdateBanner appName="Yayatoh" latestVersion="2.0.0" storeUrl={null} onDismiss={() => {}} />
      </Shell>,
    );
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeOnTheScreen();
  });
});
