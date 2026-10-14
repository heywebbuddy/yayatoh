import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { takePendingHref } from '../src/links/pending';
import { BANNER_VISIBLE_MS } from '../src/push/components';
import { PROMPT_STATE_KEY } from '../src/push/prompt-state';
import { REGISTRATION_KEY } from '../src/push/registration';
import { reportPushMoment, resetPushSignals } from '../src/push/signals';
import { fakePort, pair, push, renderApp } from './helpers/push-harness';
import { ORDER_ID, TICKET_ID } from './helpers/push-ids';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

beforeEach(() => {
  resetPushSignals();
  takePendingHref();
});

const screenName = () => screen.getByTestId('screen').props.children;
// expo-router's test library runs on fake timers: let them and the promises behind them run.
const settle = () => act(async () => void (await jest.advanceTimersByTimeAsync(50)));

async function signedInHome(options: Parameters<typeof renderApp>[0] = {}) {
  const app = renderApp(options);
  await waitFor(() => expect(app.core.session.state.status).toBe('signedIn'));
  await settle();
  return app;
}

describe('a tapped push opens its screen from a cold start', () => {
  it.each([
    ['push.order-confirmed', `/orders/${ORDER_ID}`, 'order'],
    ['push.ticket-received', `/tickets/${TICKET_ID}`, 'ticket'],
    ['push.transfer-accepted', `/orders/${ORDER_ID}`, 'order'],
    ['push.transfer-cancelled', `/tickets/${TICKET_ID}`, 'ticket'],
    ['push.event-changed', '/events/summit-2026', 'event'],
    ['push.event-cancelled', '/events/summit-2026', 'event'],
    ['push.reminder-24h', `/tickets/${TICKET_ID}`, 'ticket'],
    ['push.reminder-2h', '/events/summit-2026', 'event'],
  ])('%s -> %s', async (_kind, path, name) => {
    const port = fakePort({ permission: 'granted', launch: push(path) });
    renderApp({ port });
    await waitFor(() => expect(screen).toHavePathname(path));
    expect(screenName()).toBe(name);
  });

  it('a payload that names no screen of ours opens nothing', async () => {
    const port = fakePort({ permission: 'granted', launch: push('/admin') });
    await signedInHome({ port });
    expect(screen).toHavePathname('/');
    expect(screenName()).toBe('home');
  });

  it('a signed-out cold start lands at the front door, then the ticket opens after sign-in', async () => {
    const port = fakePort({ permission: 'granted', launch: push(`/tickets/${TICKET_ID}`) });
    const app = renderApp({ port, signedIn: false });
    await waitFor(() => expect(app.core.session.state.status).toBe('signedOut'));
    await settle();
    expect(screen).toHavePathname('/');
    // The person signs in (the sign-in screens are M7.3a's).
    await act(async () => app.core.session.setTokens(pair()));
    await waitFor(() => expect(screen).toHavePathname(`/tickets/${TICKET_ID}`));
    expect(screenName()).toBe('ticket');
  });
});

describe('a tapped push opens its screen from a warm start and from the foreground', () => {
  it('warm start: a tap while the app is in the background', async () => {
    const port = fakePort({ permission: 'granted' });
    await signedInHome({ port });
    act(() => port.emitTap(push(`/orders/${ORDER_ID}`)));
    await waitFor(() => expect(screen).toHavePathname(`/orders/${ORDER_ID}`));
    expect(screenName()).toBe('order');
  });

  it('the same notification is not opened twice (cold-start response and listener both fire)', async () => {
    const same = push(`/tickets/${TICKET_ID}`, { id: 'same' });
    const port = fakePort({ permission: 'granted', launch: same });
    await signedInHome({ port });
    await waitFor(() => expect(screen).toHavePathname(`/tickets/${TICKET_ID}`));
    // The person moves on; the system delivers the same tap again (Android does this on a cold start).
    act(() => router.push(`/orders/${ORDER_ID}`));
    await waitFor(() => expect(screen).toHavePathname(`/orders/${ORDER_ID}`));
    act(() => port.emitTap(same));
    await settle();
    expect(screen).toHavePathname(`/orders/${ORDER_ID}`);
  });

  it('foreground: the banner shows the event and what changed, and a tap opens the screen', async () => {
    const port = fakePort({ permission: 'granted' });
    await signedInHome({ port });
    act(() =>
      port.emitForeground(
        push('/events/summit-2026', { title: 'Summit 2026', body: 'The start time changed' }),
      ),
    );
    expect(await screen.findByTestId('push-banner')).toBeOnTheScreen();
    expect(screen.getByText('Summit 2026')).toBeOnTheScreen();
    expect(screen.getByText('The start time changed')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('push-banner-open'));
    await waitFor(() => expect(screen).toHavePathname('/events/summit-2026'));
    expect(screen.queryByTestId('push-banner')).toBeNull();
  });

  it('foreground: no personal data is ever drawn, even if the text has some', async () => {
    const port = fakePort({ permission: 'granted' });
    await signedInHome({ port });
    act(() =>
      port.emitForeground(
        push(`/tickets/${TICKET_ID}`, {
          title: 'Ticket for ada@example.test',
          body: 'Call +1 415 555 0100 about 0123456789abcdef0123456789abcdef',
        }),
      ),
    );
    await screen.findByTestId('push-banner');
    const shown = JSON.stringify(screen.toJSON());
    expect(shown).not.toContain('ada@example.test');
    expect(shown).not.toContain('415 555 0100');
    expect(shown).not.toContain('0123456789abcdef');
    expect(shown).toContain('[email]');
  });

  it('foreground: it can be dismissed, has a label for screen readers, and a payload with no screen is not tappable', async () => {
    const port = fakePort({ permission: 'granted' });
    await signedInHome({ port });
    act(() => port.emitForeground(push(null, { title: 'Summit 2026', body: 'Doors open at 6' })));
    const open = await screen.findByTestId('push-banner-open');
    expect(open.props.accessibilityLabel).toBe('Summit 2026. Doors open at 6');
    expect(open.props.accessibilityRole).toBe('text');
    expect(screen.getByTestId('push-banner').props.accessibilityRole).toBe('alert');
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.press(dismiss);
    expect(screen.queryByTestId('push-banner')).toBeNull();
  });
});

describe('the foreground banner', () => {
  it('goes away by itself after a few seconds', async () => {
    const port = fakePort({ permission: 'granted' });
    await signedInHome({ port });
    act(() => port.emitForeground(push('/events/summit-2026')));
    await screen.findByTestId('push-banner');
    await act(async () => void (await jest.advanceTimersByTimeAsync(BANNER_VISIBLE_MS + 100)));
    expect(screen.queryByTestId('push-banner')).toBeNull();
  });

  it('a newer notification replaces the one on screen', async () => {
    const port = fakePort({ permission: 'granted' });
    await signedInHome({ port });
    act(() => port.emitForeground(push('/events/a', { title: 'First' })));
    await screen.findByText('First');
    act(() => port.emitForeground(push('/events/b', { title: 'Second' })));
    expect(await screen.findByText('Second')).toBeOnTheScreen();
    expect(screen.queryByText('First')).toBeNull();
  });
});

describe('asking for permission (P7-8)', () => {
  it('never asks at launch, whether signed in or not', async () => {
    const port = fakePort();
    await signedInHome({ port });
    expect(screen.queryByTestId('push-preprompt')).toBeNull();
    expect(port.requested).toBe(0);
    const out = fakePort();
    renderApp({ port: out, signedIn: false });
    await settle();
    expect(out.requested).toBe(0);
  });

  it('after the first purchase: explains first, then shows the phone’s sheet, then registers the phone', async () => {
    const port = fakePort({ sheetAnswer: 'granted' });
    const app = await signedInHome({ port });
    act(() => reportPushMoment('purchase_completed'));
    expect(await screen.findByTestId('push-preprompt')).toBeOnTheScreen();
    expect(screen.getByText('Get updates about your tickets?')).toBeOnTheScreen();
    // Nothing has been asked of the phone yet, and nothing sent.
    expect(port.requested).toBe(0);
    expect(app.server.calls.filter((c) => c.path === '/v1/me/devices')).toHaveLength(0);

    fireEvent.press(screen.getByTestId('push-allow'));
    await waitFor(() => expect(port.requested).toBe(1));
    await waitFor(() =>
      expect(app.server.calls.some((c) => c.method === 'POST' && c.path === '/v1/me/devices')).toBe(true),
    );
    expect(screen.queryByTestId('push-preprompt')).toBeNull();
    expect(app.storage.data.has(REGISTRATION_KEY)).toBe(true);
  });

  it('the pre-prompt says what is sent and what never is, and its buttons are labelled', async () => {
    await signedInHome();
    act(() => reportPushMoment('purchase_completed'));
    await screen.findByTestId('push-preprompt');
    expect(
      screen.getByText(/never your name, email, phone number, payment amount or ticket code/),
    ).toBeOnTheScreen();
    expect(screen.getByText('A reminder 24 hours and 2 hours before an event starts')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Turn on notifications' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeOnTheScreen();
    expect(screen.getByText(/ask again only after a later purchase/)).toBeOnTheScreen();
  });

  it('"Not now" never shows the phone’s sheet and sends nothing', async () => {
    const port = fakePort();
    const app = await signedInHome({ port });
    act(() => reportPushMoment('purchase_completed'));
    fireEvent.press(await screen.findByTestId('push-not-now'));
    await settle();
    expect(screen.queryByTestId('push-preprompt')).toBeNull();
    expect(port.requested).toBe(0);
    expect(app.server.calls.filter((c) => c.path === '/v1/me/devices')).toHaveLength(0);
  });

  it('after "Not now", opening tickets does not ask; the next purchase does', async () => {
    const port = fakePort({ launch: null });
    const app = await signedInHome({ port });
    act(() => reportPushMoment('purchase_completed'));
    fireEvent.press(await screen.findByTestId('push-not-now'));
    await settle();

    act(() => reportPushMoment('ticket_opened'));
    act(() => reportPushMoment('ticket_opened'));
    await settle();
    expect(screen.queryByTestId('push-preprompt')).toBeNull();

    act(() => reportPushMoment('purchase_completed'));
    expect(await screen.findByTestId('push-preprompt')).toBeOnTheScreen();
    expect(JSON.parse((await app.storage.get(PROMPT_STATE_KEY)) ?? '{}')).toMatchObject({
      purchases: 2,
      deferredAtPurchases: 1,
    });
  });

  it('the first time a ticket is opened asks, through the screen itself', async () => {
    const port = fakePort();
    await signedInHome({ port });
    act(() => router.push(`/tickets/${TICKET_ID}`));
    expect(await screen.findByTestId('push-preprompt')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('push-not-now'));
    await settle();
    act(() => router.push(`/tickets/${'3'.repeat(8)}-3333-4333-8333-333333333333`));
    await settle();
    expect(screen.queryByTestId('push-preprompt')).toBeNull();
  });

  it('a refusal by the phone blocks nothing: later moments are silent, nothing is sent, the app keeps working', async () => {
    const port = fakePort({ sheetAnswer: 'denied' });
    const app = await signedInHome({ port });
    act(() => reportPushMoment('purchase_completed'));
    fireEvent.press(await screen.findByTestId('push-allow'));
    await waitFor(() => expect(port.requested).toBe(1));
    act(() => reportPushMoment('purchase_completed'));
    act(() => reportPushMoment('ticket_opened'));
    await settle();
    expect(screen.queryByTestId('push-preprompt')).toBeNull();
    expect(port.requested).toBe(1);
    expect(app.server.calls.filter((c) => c.path === '/v1/me/devices')).toHaveLength(0);
    // Navigation and everything else still work.
    act(() => router.push(`/orders/${ORDER_ID}`));
    await waitFor(() => expect(screen).toHavePathname(`/orders/${ORDER_ID}`));
  });

  it('a phone that already decided is never asked', async () => {
    for (const permission of ['granted', 'denied'] as const) {
      const port = fakePort({ permission });
      await signedInHome({ port });
      act(() => reportPushMoment('purchase_completed'));
      await settle();
      expect(screen.queryByTestId('push-preprompt')).toBeNull();
      expect(port.requested).toBe(0);
      screen.unmount();
    }
  });

  it('a purchase that completed before the app finished starting is not lost', async () => {
    reportPushMoment('purchase_completed'); // a checkout return link on a cold start
    await signedInHome();
    expect(await screen.findByTestId('push-preprompt')).toBeOnTheScreen();
  });

  it('after a purchase with the permission already on, the phone is registered again (the person now has an order)', async () => {
    const port = fakePort({ permission: 'granted' });
    const app = await signedInHome({ port });
    app.server.organizations = 0;
    await app.core.session.restore();
    await settle();
    const before = app.server.calls.filter((c) => c.method === 'POST' && c.path === '/v1/me/devices').length;
    app.server.organizations = 1;
    act(() => reportPushMoment('purchase_completed'));
    await waitFor(() =>
      expect(
        app.server.calls.filter((c) => c.method === 'POST' && c.path === '/v1/me/devices').length,
      ).toBeGreaterThan(before),
    );
  });
});

describe('registration follows the session', () => {
  it('registers a granted phone once the person is signed in, with the app’s language', async () => {
    const port = fakePort({ permission: 'granted' });
    const app = await signedInHome({ port, locale: 'pt' });
    await waitFor(() =>
      expect(app.server.calls.some((c) => c.path === '/v1/me/devices' && c.method === 'POST')).toBe(true),
    );
    const call = app.server.calls.find((c) => c.path === '/v1/me/devices' && c.method === 'POST');
    expect(call?.authorization).toMatch(/^Bearer /);
    expect(call?.body).toMatchObject({ appId: 'com.yayatoh.yayatohapp', appVersion: '1.2.3' });
  });

  it('a signed-out phone is not registered, even with permission', async () => {
    const app = renderApp({ port: fakePort({ permission: 'granted' }), signedIn: false });
    await settle();
    expect(app.server.calls.filter((c) => c.path === '/v1/me/devices')).toHaveLength(0);
  });

  it('sign-out deletes the registration first, with the session still valid, then ends the session', async () => {
    const port = fakePort({ permission: 'granted' });
    const app = await signedInHome({ port });
    await waitFor(() => expect(app.storage.data.has(REGISTRATION_KEY)).toBe(true));
    await act(async () => app.core.session.signOut());
    const order = app.server.calls.map((c) => `${c.method} ${c.path}`);
    const del = order.findIndex((c) => c.startsWith('DELETE /v1/me/devices/'));
    const revoke = order.indexOf('POST /v1/auth/revoke');
    expect(del).toBeGreaterThanOrEqual(0);
    expect(del).toBeLessThan(revoke);
    expect(app.server.calls[del]?.authorization).toMatch(/^Bearer /);
    expect(app.storage.data.has(REGISTRATION_KEY)).toBe(false);
    expect(app.core.session.state.status).toBe('signedOut');
  });

  it('sign-out still completes when the phone is offline', async () => {
    const port = fakePort({ permission: 'granted' });
    const app = await signedInHome({ port });
    await waitFor(() => expect(app.storage.data.has(REGISTRATION_KEY)).toBe(true));
    app.server.offline = true;
    await act(async () => app.core.session.signOut());
    expect(app.core.session.state.status).toBe('signedOut');
    expect(app.storage.data.has(REGISTRATION_KEY)).toBe(false);
  });

  it('names the Android channel in the app’s language', async () => {
    const port = fakePort({ permission: 'granted' });
    await signedInHome({ port });
    expect(port.channelName).toBe('Ticket and event updates');
  });
});
