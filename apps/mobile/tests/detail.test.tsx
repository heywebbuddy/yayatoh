import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ticketKeys } from '../src/tickets/api';
import { TicketDetailScreen } from '../src/tickets/screens/ticket-detail';
import { fakeServices, setOnline, setup, teardown } from './helpers/app';
import { IDS, PAST, ticket } from './helpers/fixtures';
import { resetRouter, router } from './helpers/router-mock';
import { json, problem } from './helpers/server';

jest.mock('expo-router', () => require('./helpers/router-mock').routerMock);

const apps: ReturnType<typeof setup>[] = [];
function mount(over: Parameters<typeof setup>[0] = {}) {
  const app = setup(over);
  apps.push(app);
  app.server.on('GET /v1/me/tickets/:id', () => ticket());
  // The sync after a change reads the lists.
  app.server.on('GET /v1/me/tickets', () => ({ data: [], nextCursor: null }));
  return app;
}
beforeEach(() => {
  resetRouter();
  setOnline(true);
});
afterEach(() => {
  setOnline(true);
  teardown(apps);
});

const open = async (app: ReturnType<typeof setup>) => {
  await app.ready;
  app.view(<TicketDetailScreen id={IDS.t1} />);
  return screen.findByTestId('qr-card');
};

describe('Ticket detail', () => {
  it('shows the QR code with a spoken description, and the short code spelled out for a screen reader', async () => {
    const app = mount();
    await open(app);
    expect(screen.getByRole('image', { name: 'Ticket QR code for Summer Night' })).toBeOnTheScreen();
    expect(screen.getByTestId('short-code')).toHaveAccessibleName('Ticket code A B 1 2 C D');
    expect(screen.getByText('AB12CD')).toBeOnTheScreen();
    expect(screen.getByText(/Show this code at the entrance/)).toBeOnTheScreen();
  });

  it('shows the holder, type, seat, entrances and zones, the time in the event’s zone and the venue', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets/:id', () => ticket({ seatLabel: 'Row 4, Seat 12' }));
    await open(app);
    expect(screen.getByTestId('fact-holder')).toHaveAccessibleName('Ticket holder: Ada Lovelace');
    expect(screen.getByTestId('fact-type')).toHaveAccessibleName('Ticket type: General admission');
    expect(screen.getByTestId('fact-seat')).toHaveAccessibleName('Seat: Row 4, Seat 12');
    expect(screen.getByTestId('fact-entrances')).toHaveAccessibleName(
      'Entrances and zones: North gate (entrance)\nVIP lounge (zone)',
    );
    // 19:00 UTC on 1 March is 1:00 PM in Chicago (CST), whatever the phone's own zone is.
    expect(screen.getByTestId('fact-when')).toHaveAccessibleName(
      /Fri, Mar 1, 2030, 1:00 PM – 5:00 PM (CST|GMT-6)/,
    );
    expect(screen.getByTestId('fact-where')).toHaveAccessibleName(
      'Where: Lakeside Pavilion\n1 Lake Shore Dr, Chicago, IL, 60601, US',
    );
    expect(screen.getByText('Step-free entrance on the east side.')).toBeOnTheScreen();
  });

  it('shows the organizer’s logo with its alt text, the name and the Powered by line', async () => {
    const app = mount();
    await open(app);
    expect(screen.getByRole('image', { name: 'Lakeside Events logo' })).toBeOnTheScreen();
    expect(screen.getByText('Presented by Lakeside Events')).toBeOnTheScreen();
    expect(screen.getByText('Powered by Yayatoh')).toBeOnTheScreen();
  });

  it('leaves out an unreadable brand colour but still shows the ticket (contrast fallback)', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets/:id', () =>
      ticket({ accentColor: '#fffff0', branding: { ...ticket().branding, accentColor: '#fffff0' } }),
    );
    await open(app);
    expect(screen.getByRole('image', { name: /Ticket QR code/ })).toBeOnTheScreen();
  });

  it('turns the screen to full brightness while the code is shown and puts it back on leaving', async () => {
    const fake = fakeServices();
    const app = mount({ services: fake.services });
    await app.ready;
    const view = app.view(<TicketDetailScreen id={IDS.t1} />);
    await screen.findByTestId('qr-card');
    await waitFor(() => expect(fake.log.brightness).toEqual(['full']));
    view.unmount();
    await waitFor(() => expect(fake.log.brightness).toEqual(['full', 'restored']));
  });

  describe('add to calendar and directions', () => {
    it('adds the event with its times, place and no ticket code', async () => {
      const fake = fakeServices();
      const app = mount({ services: fake.services });
      await open(app);
      fireEvent.press(screen.getByRole('button', { name: 'Add to calendar' }));
      await waitFor(() => expect(fake.log.calendar).toHaveLength(1));
      expect(fake.log.calendar[0]).toEqual({
        title: 'Summer Night',
        startsAt: new Date('2030-03-01T19:00:00Z'),
        endsAt: new Date('2030-03-01T23:00:00Z'),
        location: 'Lakeside Pavilion, 1 Lake Shore Dr, Chicago, IL, 60601, US',
        notes: 'General admission · Lakeside Events',
      });
      expect(JSON.stringify(fake.log.calendar)).not.toMatch(/AB12CD|YY1/);
      expect(await screen.findByText('Added to your calendar.')).toBeOnTheScreen();
    });

    it.each([
      ['cancelled', 'The event was not added.'],
      ['denied', /Calendar access is off/],
      ['unavailable', 'We couldn’t open your calendar.'],
    ] as const)('says what happened when the calendar answers %s', async (outcome, text) => {
      const fake = fakeServices({ addToCalendar: jest.fn(async () => outcome) });
      const app = mount({ services: fake.services });
      await open(app);
      fireEvent.press(screen.getByRole('button', { name: 'Add to calendar' }));
      expect(await screen.findByTestId('notice')).toHaveTextContent(text);
    });

    it('opens directions at the venue’s address and coordinates, and says when no maps app opened', async () => {
      const fake = fakeServices();
      const app = mount({ services: fake.services });
      await open(app);
      fireEvent.press(screen.getByRole('button', { name: 'Directions' }));
      await waitFor(() => expect(fake.log.maps).toHaveLength(1));
      expect(fake.log.maps[0]).toMatchObject({
        label: 'Lakeside Pavilion',
        latitude: 41.88,
        longitude: -87.62,
      });
    });

    it('reports a maps app that could not be opened', async () => {
      const fake = fakeServices({ openMaps: jest.fn(async () => false) });
      const app = mount({ services: fake.services });
      await open(app);
      fireEvent.press(screen.getByRole('button', { name: 'Directions' }));
      expect(await screen.findByText('We couldn’t open a maps app.')).toBeOnTheScreen();
    });

    it('has no directions when the event has no venue', async () => {
      const app = mount();
      app.server.on('GET /v1/me/tickets/:id', () =>
        ticket({ venue: null, event: { ...ticket().event, venueName: null } }),
      );
      await open(app);
      expect(screen.queryByRole('button', { name: 'Directions' })).toBeNull();
      expect(screen.getByText('Venue to be announced')).toBeOnTheScreen();
    });
  });

  describe('wallet', () => {
    it('asks for the pass link and hands it to the system', async () => {
      const fake = fakeServices();
      const app = mount({ services: fake.services });
      app.server.on('GET /v1/me/tickets/:id/wallet', () =>
        json(200, { platform: 'apple', url: 'https://wallet.example.test/p/1', serial: 'S1' }),
      );
      await open(app);
      fireEvent.press(screen.getByRole('button', { name: 'Add to Apple Wallet' }));
      await waitFor(() => expect(fake.log.wallet).toEqual(['https://wallet.example.test/p/1']));
      expect(app.server.callsTo('GET /v1/me/tickets/:id/wallet')[0]?.query.get('platform')).toBe('apple');
    });

    it('explains an unavailable wallet, a failure, and the missing connection', async () => {
      const app = mount();
      await open(app);
      app.server.on('GET /v1/me/tickets/:id/wallet', () => problem(404, 'not_found'));
      fireEvent.press(screen.getByRole('button', { name: 'Add to Apple Wallet' }));
      expect(await screen.findByText(/This wallet isn’t available/)).toBeOnTheScreen();
      app.server.on('GET /v1/me/tickets/:id/wallet', () => problem(403, 'forbidden'));
      fireEvent.press(screen.getByRole('button', { name: 'Add to Apple Wallet' }));
      expect(await screen.findByText(/couldn’t add this ticket to your wallet/)).toBeOnTheScreen();
      act(() => setOnline(false));
      fireEvent.press(screen.getByRole('button', { name: 'Add to Apple Wallet' }));
      expect(await screen.findByText(/Connect to the internet to add this ticket/)).toBeOnTheScreen();
    });
  });

  describe('states of the ticket', () => {
    it('a voided ticket (refunded or cancelled) shows no code and none of the actions', async () => {
      const app = mount();
      app.server.on('GET /v1/me/tickets/:id', () => ticket({ status: 'void', qrCode: null }));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      expect(await screen.findByTestId('void-banner')).toBeOnTheScreen();
      expect(screen.getByText('This ticket is no longer valid')).toBeOnTheScreen();
      expect(screen.getByTestId('qr-unavailable')).toBeOnTheScreen();
      expect(screen.queryByTestId('ticket-qr')).toBeNull();
      for (const name of ['Add to calendar', 'Transfer ticket', 'Request a refund', 'Add to Apple Wallet']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
    });

    it('a past event says it is over and offers neither calendar nor transfer', async () => {
      const app = mount();
      app.server.on('GET /v1/me/tickets/:id', () => ticket({ event: { ...ticket().event, ...PAST } }));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      expect(await screen.findByTestId('ended-banner')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Transfer ticket' })).toBeNull();
    });

    it('a ticket that is no longer yours (404) is dropped from the saved copy', async () => {
      const app = mount();
      app.core.queryClient.setQueryData(ticketKeys.detail(IDS.t1), ticket(), { updatedAt: 1 });
      app.server.on('GET /v1/me/tickets/:id', () => problem(404, 'not_found'));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      expect(await screen.findByTestId('ticket-gone')).toBeOnTheScreen();
      expect(screen.queryByTestId('ticket-qr')).toBeNull();
      await waitFor(() =>
        expect(app.core.queryClient.getQueryData(ticketKeys.detail(IDS.t1))).toBeUndefined(),
      );
      fireEvent.press(screen.getByRole('button', { name: 'Go to my tickets' }));
      expect(router.replace).toHaveBeenCalledWith('/tickets');
    });

    it('shows loading, then an error with a retry', async () => {
      const app = mount();
      let fail = true;
      app.server.on('GET /v1/me/tickets/:id', () => (fail ? problem(403, 'forbidden') : ticket()));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      expect(screen.getByTestId('loading')).toBeOnTheScreen();
      expect(await screen.findByTestId('ticket-error')).toBeOnTheScreen();
      fail = false;
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByTestId('qr-card')).toBeOnTheScreen();
    });
  });

  describe('offline', () => {
    it('opens from the saved copy with the network off, QR included, and says it is a saved copy', async () => {
      const app = mount();
      app.core.queryClient.setQueryData(ticketKeys.detail(IDS.t1), ticket());
      app.server.offline = true;
      setOnline(false);
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      expect(await screen.findByRole('image', { name: 'Ticket QR code for Summer Night' })).toBeOnTheScreen();
      expect(screen.getByTestId('offline-copy')).toBeOnTheScreen();
      expect(screen.getByTestId('synced-at')).toHaveTextContent(/^Last synced /);
    });

    it('keeps showing the saved copy, with a warning, when the refresh fails online', async () => {
      const app = mount();
      app.core.queryClient.setQueryData(ticketKeys.detail(IDS.t1), ticket(), { updatedAt: 1 });
      app.server.on('GET /v1/me/tickets/:id', () => problem(500, 'internal'));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      expect(
        await screen.findByRole('image', { name: /Ticket QR code/ }, { timeout: 15000 }),
      ).toBeOnTheScreen();
      expect(await screen.findByTestId('update-failed', {}, { timeout: 15000 })).toBeOnTheScreen();
    }, 30000);

    it('says nothing is saved when offline and the ticket was never synced', async () => {
      const app = mount();
      app.server.offline = true;
      setOnline(false);
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      expect(await screen.findByTestId('ticket-error', {}, { timeout: 5000 })).toBeOnTheScreen();
    });
  });

  describe('transfer', () => {
    it('offers Transfer ticket with the cutoff, and opens the transfer screen', async () => {
      const app = mount();
      await open(app);
      expect(screen.getByText(/You can transfer this ticket until/)).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Transfer ticket' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/tickets/[id]/transfer',
        params: { id: IDS.t1 },
      });
    });

    it('explains a closed transfer window with the deadline in the event’s zone', async () => {
      const app = mount();
      app.server.on('GET /v1/me/tickets/:id', () =>
        ticket({
          transfer: {
            ...ticket().transfer,
            allowed: false,
            reason: 'deadline_passed',
            deadline: '2030-02-28T18:00:00Z',
          },
        }),
      );
      await open(app);
      expect(screen.queryByRole('button', { name: 'Transfer ticket' })).toBeNull();
      expect(screen.getByTestId('transfer-refused')).toHaveTextContent(
        /Transfers closed Feb 28, 2030, 12:00 PM/,
      );
    });

    it('explains a ticket type that does not allow transfers', async () => {
      const app = mount();
      app.server.on('GET /v1/me/tickets/:id', () =>
        ticket({ transfer: { ...ticket().transfer, allowed: false, reason: 'not_allowed' } }),
      );
      await open(app);
      expect(screen.getByTestId('transfer-refused')).toHaveTextContent('This ticket can’t be transferred.');
    });

    it('shows a pending transfer and cancels it after a confirmation, with an idempotency key', async () => {
      const app = mount();
      app.server.on('GET /v1/me/tickets/:id', () =>
        ticket({
          pendingTransfer: true,
          transfer: {
            ...ticket().transfer,
            pendingTransferId: IDS.transfer,
            pendingTransferTo: 'Grace Hopper',
          },
        }),
      );
      app.server.on(
        'DELETE /v1/me/tickets/:id/transfers/:transferId',
        () => new Response(null, { status: 204 }),
      );
      await open(app);
      expect(screen.getByTestId('transfer-pending')).toHaveTextContent(/Waiting for Grace Hopper to claim/);
      expect(screen.queryByRole('button', { name: 'Transfer ticket' })).toBeNull();

      fireEvent.press(screen.getByRole('button', { name: 'Cancel transfer' }));
      expect(screen.getByText(/Cancel the transfer to Grace Hopper\?/)).toBeOnTheScreen();
      // Backing out changes nothing.
      fireEvent.press(screen.getByRole('button', { name: 'Keep transfer' }));
      expect(app.server.callsTo('DELETE /v1/me/tickets/:id/transfers/:transferId')).toHaveLength(0);

      fireEvent.press(screen.getByRole('button', { name: 'Cancel transfer' }));
      fireEvent.press(screen.getByTestId('cancel-transfer-confirm'));
      expect(await screen.findByText('Transfer cancelled.')).toBeOnTheScreen();
      const [call] = app.server.callsTo('DELETE /v1/me/tickets/:id/transfers/:transferId');
      expect(call?.path).toBe(`/v1/me/tickets/${IDS.t1}/transfers/${IDS.transfer}`);
      expect(call?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('says the cancel failed when the server refuses', async () => {
      const app = mount();
      app.server.on('GET /v1/me/tickets/:id', () =>
        ticket({
          pendingTransfer: true,
          transfer: {
            ...ticket().transfer,
            pendingTransferId: IDS.transfer,
            pendingTransferTo: 'Grace Hopper',
          },
        }),
      );
      app.server.on('DELETE /v1/me/tickets/:id/transfers/:transferId', () =>
        problem(409, 'invalid_state', { reason: 'claimed' }),
      );
      await open(app);
      fireEvent.press(screen.getByRole('button', { name: 'Cancel transfer' }));
      fireEvent.press(screen.getByTestId('cancel-transfer-confirm'));
      expect(await screen.findByText('We couldn’t cancel the transfer.')).toBeOnTheScreen();
    });
  });

  it('goes to the refund request from the ticket', async () => {
    const app = mount();
    await open(app);
    fireEvent.press(screen.getByRole('button', { name: 'Request a refund' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/tickets/[id]/refund', params: { id: IDS.t1 } });
  });

  it('goes back, or to My tickets when there is nowhere to go back to', async () => {
    const app = mount();
    await open(app);
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith('/tickets');
  });
});
