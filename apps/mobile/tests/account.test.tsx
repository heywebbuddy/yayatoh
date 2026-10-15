import { screen, waitFor } from 'expo-router/testing-library';
import { onPath, openTab, press, tab } from './helpers/actions';
import { cores, renderApp } from './helpers/app';
import { createFakeServer, USER } from './helpers/fake-server';
import { en } from './helpers/messages';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../src/auth/apple-button', () => require('./helpers/apple-button-mock'));
afterEach(() => {
  for (const c of cores.splice(0)) c.queryClient.clear();
});

async function goToAccount(app: Awaited<ReturnType<typeof renderApp>>) {
  await openTab(en.account.tabs.account);
  await onPath(app.view, '/account');
}

describe('the tab shell', () => {
  it('lands signed-in people on Tickets, with Tickets, Discover and Account tabs', async () => {
    const app = await renderApp({ signedIn: true });
    await onPath(app.view, '/tickets');
    expect(screen.getByTestId('tickets-screen')).toBeOnTheScreen();
    for (const name of [en.account.tabs.tickets, en.account.tabs.discover, en.account.tabs.account])
      expect(tab(name)).toBeOnTheScreen();
  });

  it('switches between the tabs', async () => {
    const app = await renderApp({ signedIn: true });
    await onPath(app.view, '/tickets');
    await openTab(en.account.tabs.discover);
    await onPath(app.view, '/discover');
    await goToAccount(app);
  });

  it('sends a signed-out visitor who opens a tab to the welcome screen', async () => {
    const app = await renderApp({ url: '/account' });
    await onPath(app.view, '/welcome');
  });

  it('sends a signed-in person who opens the welcome screen to Tickets', async () => {
    const app = await renderApp({ signedIn: true, url: '/welcome' });
    await onPath(app.view, '/tickets');
  });
});

describe('the account screen', () => {
  it('shows name, email and that the email is verified', async () => {
    const app = await renderApp({ signedIn: true });
    await onPath(app.view, '/tickets');
    await goToAccount(app);
    expect(screen.getByLabelText(`${en.account.profile.name}, ${USER.name}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${en.account.profile.email}, ${USER.email}`)).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`${en.account.profile.status}, ${en.account.profile.verified}`),
    ).toBeOnTheScreen();
    // They are read-only: no text field on this screen.
    expect(screen.queryByTestId('account-name')?.props.onPress).toBeUndefined();
  });

  it('shows the app version', async () => {
    const app = await renderApp({ signedIn: true });
    await onPath(app.view, '/tickets');
    await goToAccount(app);
    expect(screen.getByText('Version 1.0.0')).toBeOnTheScreen();
  });

  it('links to the notification settings screen', async () => {
    const app = await renderApp({ signedIn: true });
    await onPath(app.view, '/tickets');
    await goToAccount(app);
    await press('account-notifications');
    await onPath(app.view, '/account/notifications');
  });

  it('changes the appearance between system, light and dark, and keeps the choice', async () => {
    const app = await renderApp({ signedIn: true });
    await onPath(app.view, '/tickets');
    await goToAccount(app);
    const radio = (choice: string) =>
      screen.getByTestId(`account-theme-${choice}`).props.accessibilityState.checked;
    expect(radio('system')).toBe(true);
    await press('account-theme-dark');
    expect(radio('dark')).toBe(true);
    expect(radio('system')).toBe(false);
    await waitFor(() => expect([...app.storage.data.values()]).toContain('dark'));
  });

  describe('language', () => {
    it('lists the phone’s language and the 13 the app is translated into, and switches the whole app', async () => {
      const app = await renderApp({ signedIn: true });
      await onPath(app.view, '/tickets');
      await goToAccount(app);
      await press('account-language');
      await onPath(app.view, '/account/language');
      expect(screen.getByTestId('language-system').props.accessibilityState.checked).toBe(true);
      for (const code of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'nl', 'pt', 'ru', 'zh-CN', 'zh-TW'])
        expect(screen.getByTestId(`language-${code}`)).toBeOnTheScreen();
      await press('language-de');
      await waitFor(() =>
        expect(screen.getByTestId('language-de').props.accessibilityState.checked).toBe(true),
      );
      expect(screen.getByText('Sprache')).toBeOnTheScreen();
      // And right to left for Arabic.
      await press('language-ar');
      await waitFor(() => expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' }));
      expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    });
  });

  describe('sign out', () => {
    it('asks first, then signs out on this phone and returns to the welcome screen', async () => {
      const app = await renderApp({ signedIn: true });
      await onPath(app.view, '/tickets');
      await goToAccount(app);
      await press('account-sign-out');
      expect(screen.getByText(en.account.signOut.confirm)).toBeOnTheScreen();
      expect(app.core.session.state.status).toBe('signedIn');
      await press('account-sign-out-confirm');
      await onPath(app.view, '/welcome');
      expect(app.core.session.state.status).toBe('signedOut');
      expect(app.server.to('POST', '/v1/auth/revoke')).toHaveLength(1);
      expect(app.server.to('POST', '/v1/auth/revoke')[0]?.body).toEqual({ refreshToken: 'refresh-1' });
    });

    it('can be cancelled', async () => {
      const app = await renderApp({ signedIn: true });
      await onPath(app.view, '/tickets');
      await goToAccount(app);
      await press('account-sign-out');
      await press('account-sign-out-cancel');
      expect(screen.getByTestId('account-sign-out')).toBeOnTheScreen();
      expect(app.core.session.state.status).toBe('signedIn');
    });

    it('still signs out when the phone is offline (the server is told on a best-effort basis)', async () => {
      const server = createFakeServer();
      const app = await renderApp({ signedIn: true, server });
      await onPath(app.view, '/tickets');
      await goToAccount(app);
      server.config.offline = true;
      await press('account-sign-out');
      await press('account-sign-out-confirm');
      await onPath(app.view, '/welcome');
      expect(app.core.session.state.status).toBe('signedOut');
    });

    it('wipes the cache and its key from the phone', async () => {
      const app = await renderApp({ signedIn: true });
      await onPath(app.view, '/tickets');
      app.core.queryClient.setQueryData(['tickets'], [{ id: 'secret' }]);
      await goToAccount(app);
      await press('account-sign-out');
      await press('account-sign-out-confirm');
      await onPath(app.view, '/welcome');
      expect(app.core.queryClient.getQueryData(['tickets'])).toBeUndefined();
      expect([...app.storage.data.keys()].filter((k) => k.includes('session'))).toEqual([]);
    });
  });

  describe('sign out everywhere', () => {
    it('asks the server to end every session, then signs out here and returns to the welcome screen', async () => {
      const app = await renderApp({ signedIn: true });
      await onPath(app.view, '/tickets');
      await goToAccount(app);
      await press('account-sign-out-everywhere');
      expect(screen.getByText(en.account.signOutEverywhere.confirm)).toBeOnTheScreen();
      await press('account-everywhere-confirm');
      await onPath(app.view, '/welcome');
      expect(app.server.to('POST', '/v1/auth/sign-out-everywhere')).toHaveLength(1);
      expect(app.server.to('POST', '/v1/auth/sign-out-everywhere')[0]?.authorization).toBe('Bearer access-1');
      expect(app.core.session.state.status).toBe('signedOut');
      expect(app.storage.data.size).toBe(0);
    });

    it('does not pretend when the server could not be reached: the person stays signed in with a message', async () => {
      const server = createFakeServer();
      const app = await renderApp({ signedIn: true, server });
      await onPath(app.view, '/tickets');
      await goToAccount(app);
      server.config.signOutEverywhereStatus = 503;
      await press('account-sign-out-everywhere');
      await press('account-everywhere-confirm');
      await waitFor(() => expect(screen.getByText(en.account.signOutEverywhere.failed)).toBeOnTheScreen());
      expect(app.core.session.state.status).toBe('signedIn');
      expect(app.view.getPathname()).toBe('/account');
      server.config.signOutEverywhereStatus = 204;
      await press('account-everywhere-confirm');
      await onPath(app.view, '/welcome');
    });

    it('can be cancelled', async () => {
      const app = await renderApp({ signedIn: true });
      await onPath(app.view, '/tickets');
      await goToAccount(app);
      await press('account-sign-out-everywhere');
      await press('account-everywhere-cancel');
      expect(screen.getByTestId('account-sign-out-everywhere')).toBeOnTheScreen();
      expect(app.server.to('POST', '/v1/auth/sign-out-everywhere')).toHaveLength(0);
    });
  });
});
