import { act, render, screen } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { LocaleProvider } from '../src/i18n/provider';
import { bindQueryToNetwork, isOffline, OfflineBanner, subscribeToNetwork } from '../src/platform/network';
import { ThemeProvider } from '../src/theme/provider';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(),
  addNetworkStateListener: jest.fn(),
}));

const mocked = Network as unknown as {
  getNetworkStateAsync: jest.Mock;
  addNetworkStateListener: jest.Mock;
};

let emit: (s: { isConnected?: boolean; isInternetReachable?: boolean }) => void = () => {};
beforeEach(() => {
  mocked.getNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  mocked.addNetworkStateListener.mockImplementation((cb) => {
    emit = cb;
    return { remove: jest.fn() };
  });
});

const Shell = ({ children, tags = ['en-US'] }: { children: React.ReactNode; tags?: string[] }) => (
  <ThemeProvider>
    <LocaleProvider
      catalogs={{}}
      deviceLanguageTags={tags}
      direction={{ isRTL: tags[0]?.startsWith('ar') ?? false, allowRTL: () => {}, forceRTL: () => {}, reload: async () => {} }}
    >
      {children}
    </LocaleProvider>
  </ThemeProvider>
);

describe('isOffline', () => {
  it('is offline only when the phone says so; unknown counts as online', () => {
    expect(isOffline({ isConnected: false })).toBe(true);
    expect(isOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
    expect(isOffline({ isConnected: true, isInternetReachable: true })).toBe(false);
    expect(isOffline({})).toBe(false);
    expect(isOffline(null)).toBe(false);
    expect(isOffline({ isConnected: true, isInternetReachable: null })).toBe(false);
  });
});

describe('OfflineBanner', () => {
  it('renders nothing online', async () => {
    render(
      <Shell>
        <OfflineBanner />
      </Shell>,
    );
    await act(async () => {});
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('appears when the phone goes offline and disappears when it is back', async () => {
    render(
      <Shell>
        <OfflineBanner />
      </Shell>,
    );
    await act(async () => {});
    act(() => emit({ isConnected: false }));
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(screen.getByText(/You're offline/)).toBeOnTheScreen();
    act(() => emit({ isConnected: true, isInternetReachable: true }));
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('is already showing when the first reading says offline', async () => {
    mocked.getNetworkStateAsync.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    render(
      <Shell>
        <OfflineBanner />
      </Shell>,
    );
    await act(async () => {});
    expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();
  });

  it('says how many changes wait, with the right plural', () => {
    render(
      <Shell>
        <OfflineBanner offline queued={1} />
      </Shell>,
    );
    expect(screen.getByText("1 change will be sent when you're back online.")).toBeOnTheScreen();
    screen.unmount();
    render(
      <Shell>
        <OfflineBanner offline queued={4} />
      </Shell>,
    );
    expect(screen.getByText("4 changes will be sent when you're back online.")).toBeOnTheScreen();
  });

  it('renders in Arabic, right to left, as an alert', () => {
    render(
      <Shell tags={['ar-EG']}>
        <OfflineBanner offline />
      </Shell>,
    );
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(screen.getByText(/أنت غير متصل/)).toBeOnTheScreen();
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
  });

  it('can be forced on or off by the screen', () => {
    render(
      <Shell>
        <OfflineBanner offline={false} />
      </Shell>,
    );
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});

describe('network binding', () => {
  it('reports online/offline to listeners and unsubscribes', () => {
    const seen: boolean[] = [];
    const stop = subscribeToNetwork((o) => seen.push(o));
    emit({ isConnected: false });
    emit({ isConnected: true, isInternetReachable: true });
    expect(seen).toEqual([false, true]);
    stop();
    expect(mocked.addNetworkStateListener.mock.results[0]?.value.remove).toHaveBeenCalled();
  });

  it('pauses TanStack Query while offline', () => {
    const unbind = bindQueryToNetwork();
    emit({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);
    emit({ isConnected: true, isInternetReachable: true });
    expect(onlineManager.isOnline()).toBe(true);
    unbind();
  });
});
