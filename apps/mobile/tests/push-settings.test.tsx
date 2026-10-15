import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { catalogs } from '../src/i18n';
import type { KindPreferences, PreferencesPort } from '../src/push/preferences';
import { PROMPT_STATE_KEY } from '../src/push/prompt-state';
import { resetPushSignals } from '../src/push/signals';
import { fakePort, renderApp } from './helpers/push-harness';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

beforeEach(() => resetPushSignals());

const settle = () => act(async () => void (await jest.advanceTimersByTimeAsync(50)));

async function openSettings(options: Parameters<typeof renderApp>[0] = {}) {
  const app = renderApp({ initialUrl: '/account/notifications', ...options });
  await screen.findByTestId('notification-settings');
  await settle();
  return app;
}

/** A preferences port that saves, for the day the server stores them. */
function savingPreferences(initial: KindPreferences = { reminders: true, eventChanges: true }) {
  const saved: KindPreferences[] = [];
  const port: PreferencesPort & { fail: boolean } = {
    supported: true,
    fail: false,
    load: async () => initial,
    save: async (next) => {
      if (port.fail) throw new Error('offline');
      saved.push(next);
    },
  };
  return { port, saved };
}

describe('Notifications screen: the phone’s permission', () => {
  it.each([
    ['granted', 'Notifications are on', 'Open phone settings'],
    ['denied', 'Notifications are off', 'Open phone settings'],
    ['undetermined', 'Notifications are not set up yet', 'Turn on notifications'],
  ] as const)('%s shows "%s" with "%s"', async (permission, status, button) => {
    await openSettings({ port: fakePort({ permission }) });
    expect(screen.getByTestId('permission-status')).toHaveTextContent(status);
    expect(screen.getByRole('button', { name: button })).toBeOnTheScreen();
  });

  it('links to the phone’s settings when notifications are on or off', async () => {
    for (const permission of ['granted', 'denied'] as const) {
      const port = fakePort({ permission });
      await openSettings({ port });
      fireEvent.press(screen.getByTestId('open-system-settings'));
      await waitFor(() => expect(port.settingsOpened).toBe(1));
      screen.unmount();
    }
  });

  it('turning on explains first, then asks the phone; it does not touch the "Not now" memory', async () => {
    const port = fakePort({ permission: 'undetermined', sheetAnswer: 'granted' });
    const app = await openSettings({ port });
    fireEvent.press(screen.getByTestId('turn-on'));
    expect(await screen.findByTestId('push-preprompt')).toBeOnTheScreen();
    expect(port.requested).toBe(0);
    // From settings the person chose this themselves: no promise to ask again after a purchase.
    expect(screen.getByText(/change this any time in Account, Notifications/)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('push-allow'));
    await waitFor(() => expect(port.requested).toBe(1));
    await waitFor(() =>
      expect(screen.getByTestId('permission-status')).toHaveTextContent('Notifications are on'),
    );
    expect(app.storage.data.has(PROMPT_STATE_KEY)).toBe(false);
  });

  it('"Not now" from settings leaves everything as it was', async () => {
    const port = fakePort({ permission: 'undetermined' });
    const app = await openSettings({ port });
    fireEvent.press(screen.getByTestId('turn-on'));
    fireEvent.press(await screen.findByTestId('push-not-now'));
    await settle();
    expect(screen.queryByTestId('push-preprompt')).toBeNull();
    expect(port.requested).toBe(0);
    expect(app.storage.data.has(PROMPT_STATE_KEY)).toBe(false);
  });

  it('says plainly that notifications are optional', async () => {
    await openSettings({ port: fakePort({ permission: 'denied' }) });
    expect(screen.getByText(/Tickets, orders and sign-in work the same with them off/)).toBeOnTheScreen();
  });

  it('shows the screen even before the phone has answered (loading)', async () => {
    const port = fakePort();
    port.getPermission = () => new Promise(() => {});
    renderApp({ initialUrl: '/account/notifications', port });
    await screen.findByTestId('notification-settings');
    expect(screen.getByTestId('permission-status')).toHaveTextContent('Checking…');
    expect(screen.queryByTestId('turn-on')).toBeNull();
    expect(screen.queryByTestId('open-system-settings')).toBeNull();
  });
});

describe('Notifications screen: what is sent', () => {
  it('lists the kinds; without server storage it says so instead of showing switches that do nothing', async () => {
    await openSettings({ port: fakePort({ permission: 'granted' }) });
    expect(screen.getByText('Orders and tickets')).toBeOnTheScreen();
    expect(screen.getByText('Reminders')).toBeOnTheScreen();
    expect(screen.getByText('Event changes')).toBeOnTheScreen();
    expect(screen.queryByTestId('switch-reminders')).toBeNull();
    expect(screen.getByTestId('kinds-unavailable')).toBeOnTheScreen();
  });

  it('with server storage: switches load, save, and are labelled', async () => {
    const { port: preferences, saved } = savingPreferences({ reminders: true, eventChanges: false });
    await openSettings({ port: fakePort({ permission: 'granted' }), preferences });
    const reminders = screen.getByRole('switch', { name: 'Reminders' });
    const changes = screen.getByRole('switch', { name: 'Event changes' });
    expect(reminders).toHaveProp('value', true);
    expect(changes).toHaveProp('value', false);
    expect(screen.queryByTestId('kinds-unavailable')).toBeNull();

    fireEvent(reminders, 'valueChange', false);
    await waitFor(() => expect(saved).toEqual([{ reminders: false, eventChanges: false }]));
    expect(screen.getByRole('switch', { name: 'Reminders' })).toHaveProp('value', false);
    fireEvent(changes, 'valueChange', true);
    await waitFor(() => expect(saved.at(-1)).toEqual({ reminders: false, eventChanges: true }));
  });

  it('with server storage: a failed save puts the switch back and says so', async () => {
    const { port: preferences } = savingPreferences();
    preferences.fail = true;
    await openSettings({ port: fakePort({ permission: 'granted' }), preferences });
    fireEvent(screen.getByRole('switch', { name: 'Reminders' }), 'valueChange', false);
    expect(await screen.findByTestId('save-failed')).toHaveTextContent(/could not save/);
    expect(screen.getByRole('switch', { name: 'Reminders' })).toHaveProp('value', true);
  });

  it('marketing pushes are off, with no switch to turn them on here', async () => {
    await openSettings({ port: fakePort({ permission: 'granted' }), preferences: savingPreferences().port });
    expect(screen.getByText('News and offers')).toBeOnTheScreen();
    expect(screen.getByTestId('marketing-off')).toHaveTextContent(/^Off\./);
    expect(screen.queryByRole('switch', { name: /News|offers|Marketing/i })).toBeNull();
  });

  it('headings are headings for screen readers', async () => {
    await openSettings({ port: fakePort({ permission: 'granted' }) });
    for (const name of ['On this phone', 'What we send', 'News and offers']) {
      expect(screen.getByRole('header', { name })).toBeOnTheScreen();
    }
  });
});

describe('right to left', () => {
  it('renders Notifications and the pre-prompt in Arabic, right to left', async () => {
    const t = catalogs.ar.push;
    const port = fakePort({ permission: 'undetermined' });
    renderApp({ initialUrl: '/account/notifications', port, locale: 'ar' });
    await screen.findByTestId('notification-settings');
    await waitFor(() => expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' }));
    expect(screen.getByTestId('permission-status')).toHaveTextContent(t.settings.status.undetermined);
    expect(screen.getByRole('button', { name: t.settings.turnOn })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: t.settings.statusTitle })).toBeOnTheScreen();
    expect(screen.getByText(t.settings.kindsUnavailable)).toBeOnTheScreen();
    expect(screen.getByText(t.settings.marketingBody)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('turn-on'));
    await screen.findByTestId('push-preprompt');
    expect(screen.getByText(t.prompt.title)).toBeOnTheScreen();
    expect(screen.getByText(t.prompt.privacy)).toBeOnTheScreen();
    expect(screen.getByTestId('push-allow')).toHaveProp('accessibilityLabel', t.prompt.allow);
    expect(screen.getByTestId('push-not-now')).toHaveProp('accessibilityLabel', t.prompt.notNow);
    // The English text is gone; text alignment follows the language.
    expect(screen.queryByText('Get updates about your tickets?')).toBeNull();
    expect(screen.getByText(t.prompt.title)).toHaveStyle({ textAlign: 'auto' });
  });
});
