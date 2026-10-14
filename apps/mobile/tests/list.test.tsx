import { dehydrate } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { ticketKeys } from '../src/tickets/api';
import { TicketsListScreen } from '../src/tickets/screens/tickets-list';
import { syncTickets } from '../src/tickets/sync';
import { setOnline, setup } from './helpers/app';
import { event, FUTURE, IDS, page, summary, ticket } from './helpers/fixtures';
import { resetRouter, router } from './helpers/router-mock';
import { problem } from './helpers/server';

jest.mock('expo-router', () => require('./helpers/router-mock').routerMock);

const apps: ReturnType<typeof setup>[] = [];
function mount(opts: Parameters<typeof setup>[0] = {}) {
  const app = setup(opts);
  apps.push(app);
  app.server.on('GET /v1/me/tickets/:id', (_c, p) => ticket({ id: p.id as string }) as never);
  return app;
}

beforeEach(() => {
  resetRouter();
  setOnline(true);
});
afterEach(() => {
  setOnline(true);
  // A cached query keeps a seven-day garbage-collection timer, which would keep Jest alive.
  for (const app of apps.splice(0)) app.core.queryClient.clear();
});

const t1 = summary({ id: IDS.t1 });
const t2 = summary({ id: IDS.t2, holderName: 'Grace Hopper', seatLabel: 'Row 4, Seat 12', serial: 2 });
const gala = summary({
  id: IDS.t3,
  serial: 3,
  ticketTypeName: 'VIP',
  holderName: 'Ada Lovelace',
  accentColor: null,
  organizerName: 'Harbor Arts',
  event: event({
    id: IDS.event2,
    name: 'Harbor Gala',
    startsAt: '2030-04-10T19:00:00Z',
    endsAt: '2030-04-10T23:00:00Z',
  }),
});

describe('My tickets', () => {
  it('shows a loading state, then upcoming tickets grouped by event with day, time zone and holder', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', () => page([t1, t2, gala]) as never);
    await app.ready;
    app.view(<TicketsListScreen />);
    expect(screen.getByTestId('loading')).toBeOnTheScreen();
    expect(await screen.findByTestId(`ticket-card-${IDS.t1}`)).toBeOnTheScreen();

    // One heading per event, with the event's own day and its time zone.
    const headers = screen.getAllByRole('header');
    expect(headers.map((h) => within(h).queryByText('Summer Night')).filter(Boolean)).toHaveLength(1);
    expect(screen.getByText('Harbor Gala')).toBeOnTheScreen();
    expect(screen.getByText('Friday, March 1, 2030')).toBeOnTheScreen();
    expect(screen.getAllByText(/CST|GMT-6/).length).toBeGreaterThan(0);
    expect(screen.getByText('Lakeside Events · 2 tickets')).toBeOnTheScreen();
    expect(screen.getByText('Seat Row 4, Seat 12')).toBeOnTheScreen();

    // Each card says what it is to a screen reader.
    expect(
      screen.getByRole('button', {
        name: /General admission for Summer Night, .*Held by Ada Lovelace\./,
      }),
    ).toBeOnTheScreen();
  });

  it('opens a ticket from its card', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', () => page([t1]) as never);
    await app.ready;
    app.view(<TicketsListScreen />);
    fireEvent.press(await screen.findByTestId(`ticket-card-${IDS.t1}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/tickets/[id]', params: { id: IDS.t1 } });
  });

  it('flags a ticket whose transfer is waiting to be claimed, in words', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', () => page([{ ...t1, pendingTransfer: true }]) as never);
    await app.ready;
    app.view(<TicketsListScreen />);
    expect(await screen.findByText('Transfer pending')).toBeOnTheScreen();
  });

  it('pages with the keyset cursor when the end of the list is reached', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', (c) => {
      if (c.query.get('when') === 'past') return page([]) as never;
      return (c.query.get('cursor') === 'next-1' ? page([t2]) : page([t1], 'next-1')) as never;
    });
    await app.ready;
    app.view(<TicketsListScreen />);
    await screen.findByTestId(`ticket-card-${IDS.t1}`);
    // The sync takes the whole upcoming list, so both tickets are there already; reaching the end
    // asks for no page that does not exist.
    await screen.findByTestId(`ticket-card-${IDS.t2}`);
    const cursors = app.server
      .callsTo('GET /v1/me/tickets')
      .filter((c) => c.query.get('when') === 'upcoming')
      .map((c) => c.query.get('cursor'));
    expect(cursors).toContain('next-1');
  });

  it('shows the empty state for upcoming with a way to Discover, and for past without one', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', () => page([]) as never);
    await app.ready;
    app.view(<TicketsListScreen />);
    expect(await screen.findByText('No upcoming tickets')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Find events' }));
    expect(router.push).toHaveBeenCalledWith('/discover');
    fireEvent.press(screen.getByRole('tab', { name: 'Past' }));
    expect(await screen.findByText('No past tickets')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Find events' })).toBeNull();
  });

  it('lists past tickets under the Past tab', async () => {
    const app = mount();
    const old = summary({
      id: IDS.t4,
      event: event({ name: 'Retro Night', startsAt: '2020-03-01T19:00:00Z', endsAt: '2020-03-01T23:00:00Z' }),
    });
    app.server.on(
      'GET /v1/me/tickets',
      (c) => (c.query.get('when') === 'past' ? page([old]) : page([])) as never,
    );
    await app.ready;
    app.view(<TicketsListScreen />);
    fireEvent.press(await screen.findByRole('tab', { name: 'Past' }));
    expect(await screen.findByText('Retro Night')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Past' })).toBeSelected();
  });

  it('shows an error with a retry when nothing can be loaded', async () => {
    const app = mount();
    let fail = true;
    app.server.on('GET /v1/me/tickets', () => (fail ? problem(403, 'forbidden') : (page([t1]) as never)));
    await app.ready;
    app.view(<TicketsListScreen />);
    expect(await screen.findByText('We couldn’t load your tickets.')).toBeOnTheScreen();
    fail = false;
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId(`ticket-card-${IDS.t1}`)).toBeOnTheScreen();
  });

  it('says so when it is offline and nothing is saved on the phone yet', async () => {
    const app = mount();
    setOnline(false);
    app.server.offline = true;
    await app.ready;
    app.view(<TicketsListScreen />);
    expect(await screen.findByTestId('offline-empty', {}, { timeout: 4000 })).toBeOnTheScreen();
    expect(screen.getByText(/nothing is saved on this phone yet/)).toBeOnTheScreen();
  });

  describe('sync', () => {
    it('keeps every ticket’s record for offline use and stamps when it last synced', async () => {
      const app = mount();
      app.server.on(
        'GET /v1/me/tickets',
        (c) => (c.query.get('when') === 'past' ? page([]) : page([t1, gala])) as never,
      );
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId(`ticket-card-${IDS.t1}`);
      await waitFor(() =>
        expect(app.core.queryClient.getQueryData(ticketKeys.synced)).toEqual(expect.any(String)),
      );
      expect(app.core.queryClient.getQueryData(ticketKeys.detail(IDS.t1))).toMatchObject({
        qrCode: expect.any(String),
      });
      expect(app.core.queryClient.getQueryData(ticketKeys.detail(IDS.t3))).toBeDefined();
      expect(await screen.findByText(/^Last synced /)).toBeOnTheScreen();
    });

    it('fetches a ticket’s record again only when its revision changed, or when pulled to refresh', async () => {
      const app = mount();
      let rev = 1;
      app.server.on(
        'GET /v1/me/tickets',
        (c) => (c.query.get('when') === 'past' ? page([]) : page([{ ...t1, rev }])) as never,
      );
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId(`ticket-card-${IDS.t1}`);
      await waitFor(() => expect(app.server.callsTo('GET /v1/me/tickets/:id')).toHaveLength(1));

      const refresh = () =>
        act(async () => {
          screen.getByTestId('tickets-list').props.refreshControl.props.onRefresh();
          await new Promise((r) => setTimeout(r, 50));
        });
      // Pull to refresh always re-reads the record.
      await refresh();
      await waitFor(() => expect(app.server.callsTo('GET /v1/me/tickets/:id')).toHaveLength(2));

      // A sync that finds the same revision (not forced) keeps what it has.
      await syncTickets({ api: app.core.api, queryClient: app.core.queryClient });
      expect(app.server.callsTo('GET /v1/me/tickets/:id')).toHaveLength(2);

      // A new revision (the code was reissued) is fetched.
      rev = 2;
      await syncTickets({ api: app.core.api, queryClient: app.core.queryClient });
      expect(app.server.callsTo('GET /v1/me/tickets/:id')).toHaveLength(3);
    });

    it('drops a ticket that left the list (transferred away) after a refresh, with its saved record', async () => {
      const app = mount();
      let tickets = [t1, t2];
      app.server.on(
        'GET /v1/me/tickets',
        (c) => (c.query.get('when') === 'past' ? page([]) : page(tickets)) as never,
      );
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId(`ticket-card-${IDS.t2}`);
      await waitFor(() => expect(app.core.queryClient.getQueryData(ticketKeys.detail(IDS.t2))).toBeDefined());

      tickets = [t1];
      await act(async () => {
        screen.getByTestId('tickets-list').props.refreshControl.props.onRefresh();
        await new Promise((r) => setTimeout(r, 50));
      });
      await waitFor(() => expect(screen.queryByTestId(`ticket-card-${IDS.t2}`)).toBeNull());
      expect(screen.getByTestId(`ticket-card-${IDS.t1}`)).toBeOnTheScreen();
      expect(app.core.queryClient.getQueryData(ticketKeys.detail(IDS.t2))).toBeUndefined();
    });

    it('warns, and keeps the saved list, when a refresh fails', async () => {
      const app = mount();
      let fail = false;
      app.server.on('GET /v1/me/tickets', (c) => {
        if (fail) return problem(500, 'internal');
        return (c.query.get('when') === 'past' ? page([]) : page([t1])) as never;
      });
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId(`ticket-card-${IDS.t1}`);
      fail = true;
      await act(async () => {
        screen.getByTestId('tickets-list').props.refreshControl.props.onRefresh();
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(await screen.findByTestId('refresh-failed')).toBeOnTheScreen();
      expect(screen.getByTestId(`ticket-card-${IDS.t1}`)).toBeOnTheScreen();
    });
  });

  describe('offline and sign-out', () => {
    async function syncedApp() {
      const app = mount();
      app.server.on(
        'GET /v1/me/tickets',
        (c) => (c.query.get('when') === 'past' ? page([]) : page([t1, gala])) as never,
      );
      await app.ready;
      const first = app.view(<TicketsListScreen />);
      await screen.findByTestId(`ticket-card-${IDS.t1}`);
      await waitFor(() => expect(app.core.queryClient.getQueryData(ticketKeys.synced)).toBeDefined());
      await app.core.persister.persistClient({
        timestamp: Date.now(),
        buster: '1.0.0',
        clientState: dehydrate(app.core.queryClient, {
          shouldDehydrateQuery: (q) => q.state.status === 'success',
        }),
      });
      first.unmount();
      return app;
    }

    it('opens My tickets with the network off, from the encrypted copy on the phone', async () => {
      const online = await syncedApp();
      // A new launch: a new core over the same stores, and the phone has no connection.
      const second = setup({ phone: { storage: online.storage, files: online.files } });
      apps.push(second);
      second.server.offline = true;
      setOnline(false);
      await second.ready;
      second.view(<TicketsListScreen />);
      expect(await screen.findByTestId(`ticket-card-${IDS.t1}`)).toBeOnTheScreen();
      expect(screen.getByTestId(`ticket-card-${IDS.t3}`)).toBeOnTheScreen();
      expect(screen.getByTestId('offline-note')).toBeOnTheScreen();
      expect(screen.getByText(/^Last synced /)).toBeOnTheScreen();
      // The saved copy holds every ticket's QR code.
      await waitFor(() =>
        expect(second.core.queryClient.getQueryData(ticketKeys.detail(IDS.t1))).toMatchObject({
          qrCode: expect.any(String),
        }),
      );
    });

    it('removes the tickets, their codes and the cache key at sign-out', async () => {
      const app = await syncedApp();
      expect(app.files.files.size).toBe(1);
      await app.core.session.signOut();
      expect(app.core.queryClient.getQueryData(ticketKeys.list('upcoming'))).toBeUndefined();
      expect(app.core.queryClient.getQueryData(ticketKeys.detail(IDS.t1))).toBeUndefined();
      expect(app.files.files.size).toBe(0);
      expect([...app.storage.data.keys()].some((k) => k.includes('cache-key'))).toBe(false);
    });
  });

  it('picks up a claim link opened before sign-in and takes the person to it', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', () => page([]) as never);
    await app.storage.set(
      'yayatoh.pending-ticket-link.v1',
      JSON.stringify({ kind: 'claim', token: 'abcdefghij12' }),
    );
    await app.ready;
    app.view(<TicketsListScreen />);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/claim/[token]',
        params: { token: 'abcdefghij12' },
      }),
    );
    expect(await app.storage.get('yayatoh.pending-ticket-link.v1')).toBeNull();
  });

  it('does nothing while signed out', async () => {
    const app = mount({ signedIn: false });
    await app.ready;
    app.view(<TicketsListScreen />);
    await screen.findByTestId('tickets-screen');
    expect(app.server.callsTo('GET /v1/me/tickets').length).toBe(0);
    void FUTURE;
  });
});
