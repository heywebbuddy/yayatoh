import { act, screen, waitFor } from 'expo-router/testing-library';
import { onPath, press } from './helpers/actions';
import { cores, renderApp } from './helpers/app';
import { en } from './helpers/messages';
import { AvailableMethodsCases } from './helpers/methods-cases';

const mockNetwork = {
  state: { isConnected: true, isInternetReachable: true } as {
    isConnected: boolean;
    isInternetReachable: boolean;
  },
  listener: null as null | ((s: { isConnected: boolean; isInternetReachable: boolean }) => void),
};
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => mockNetwork.state),
  addNetworkStateListener: jest.fn((fn: (s: unknown) => void) => {
    mockNetwork.listener = fn as never;
    return { remove: jest.fn() };
  }),
}));
jest.mock('../src/auth/apple-button', () => require('./helpers/apple-button-mock'));
afterEach(() => {
  mockNetwork.state = { isConnected: true, isInternetReachable: true };
  for (const c of cores.splice(0)) c.queryClient.clear();
});

describe('opening the app', () => {
  it('shows a loading state, never a blank screen, while the stored session is read', async () => {
    const app = await renderApp({ skipRestore: true });
    expect(screen.getByTestId('session-splash')).toBeOnTheScreen();
    expect(screen.getByLabelText(en.welcome.loading)).toBeOnTheScreen();
    await act(async () => {
      await app.core.session.restore();
    });
    await onPath(app.view, '/welcome');
  });

  it('opens signed-out people on the welcome screen', async () => {
    const app = await renderApp();
    await onPath(app.view, '/welcome');
    expect(screen.getByRole('header', { name: en.welcome.title })).toBeOnTheScreen();
    expect(screen.getByText(en.welcome.tagline)).toBeOnTheScreen();
  });

  it('opens signed-in people on Tickets', async () => {
    const app = await renderApp({ signedIn: true });
    await onPath(app.view, '/tickets');
  });

  it('keeps people signed in across a restart (the session is read back from secure storage)', async () => {
    const first = await renderApp({ signedIn: true });
    await onPath(first.view, '/tickets');
    const second = await renderApp({ storage: first.storage });
    await onPath(second.view, '/tickets');
  });
});

describe('the welcome screen', () => {
  it('lists the ways in: email, Apple, password; Google only where the build has it', async () => {
    const app = await renderApp();
    await onPath(app.view, '/welcome');
    expect(screen.getByRole('button', { name: en.welcome.email })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en.welcome.apple })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en.welcome.password })).toBeOnTheScreen();
    // This build has no Google client id.
    expect(screen.queryByTestId('welcome-google')).toBeNull();
  });

  it('explains what the app does', async () => {
    const app = await renderApp();
    await onPath(app.view, '/welcome');
    for (const key of ['pointTickets', 'pointDiscover', 'pointUpdates'] as const)
      expect(screen.getByText(en.welcome[key])).toBeOnTheScreen();
  });
});

describe('first launch without a network', () => {
  it('says so, with a retry, instead of offering sign-in that cannot work', async () => {
    mockNetwork.state = { isConnected: false, isInternetReachable: false };
    const app = await renderApp();
    await onPath(app.view, '/welcome');
    await waitFor(() => expect(screen.getByTestId('welcome-offline')).toBeOnTheScreen());
    expect(screen.getByText(en.welcome.offlineTitle)).toBeOnTheScreen();
    expect(screen.getByText(en.welcome.offlineBody)).toBeOnTheScreen();
    expect(screen.queryByTestId('welcome-email')).toBeNull();
  });

  it('"Try again" checks the network and brings the sign-in options back once it is there', async () => {
    mockNetwork.state = { isConnected: false, isInternetReachable: false };
    const app = await renderApp();
    await onPath(app.view, '/welcome');
    await waitFor(() => expect(screen.getByTestId('welcome-retry')).toBeOnTheScreen());
    await press('welcome-retry');
    expect(screen.getByTestId('welcome-offline')).toBeOnTheScreen();
    mockNetwork.state = { isConnected: true, isInternetReachable: true };
    await press('welcome-retry');
    await waitFor(() => expect(screen.getByTestId('welcome-email')).toBeOnTheScreen());
    expect(screen.queryByTestId('welcome-offline')).toBeNull();
  });

  it('comes back by itself when the phone reconnects', async () => {
    mockNetwork.state = { isConnected: false, isInternetReachable: false };
    const app = await renderApp();
    await onPath(app.view, '/welcome');
    await waitFor(() => expect(screen.getByTestId('welcome-offline')).toBeOnTheScreen());
    act(() => mockNetwork.listener?.({ isConnected: true, isInternetReachable: true }));
    await waitFor(() => expect(screen.getByTestId('welcome-email')).toBeOnTheScreen());
  });

  it('a signed-in person offline still lands on Tickets (their saved tickets are theirs to see)', async () => {
    mockNetwork.state = { isConnected: false, isInternetReachable: false };
    const app = await renderApp({ signedIn: true });
    await onPath(app.view, '/tickets');
  });
});

AvailableMethodsCases();
