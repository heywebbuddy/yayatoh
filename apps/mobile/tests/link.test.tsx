import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { PENDING_KEY } from '../src/tickets/pending';
import { TicketLinkScreen } from '../src/tickets/screens/ticket-link';
import { setOnline, setup, teardown } from './helpers/app';
import { IDS, ticket } from './helpers/fixtures';
import { resetRouter, router } from './helpers/router-mock';
import { json, problem } from './helpers/server';

jest.mock('expo-router', () => require('./helpers/router-mock').routerMock);

const TOKEN = '11111111-1111-4111-8111-111111111111~signature';
const apps: ReturnType<typeof setup>[] = [];
function mount(over: Parameters<typeof setup>[0] = {}) {
  const app = setup(over);
  apps.push(app);
  app.server.on('GET /v1/me/tickets/:id', (_c, p) =>
    ticket({ id: p.id as string, holderName: p.id === IDS.t2 ? 'Grace Hopper' : 'Ada Lovelace' }),
  );
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

describe('Ticket link', () => {
  it('asks a signed-out person to sign in and remembers the link', async () => {
    const app = mount({ signedIn: false });
    await app.ready;
    app.view(<TicketLinkScreen token={TOKEN} />);
    expect(await screen.findByTestId('link-sign-in')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/welcome'));
    expect(JSON.parse((await app.storage.get(PENDING_KEY)) ?? '{}')).toMatchObject({
      kind: 'link',
      token: TOKEN,
    });
    expect(app.server.callsTo('GET /v1/me/ticket-links/:token')).toHaveLength(0);
  });

  it('opens the one ticket the link names, after sign-in', async () => {
    const app = mount();
    app.server.on('GET /v1/me/ticket-links/:token', () => json(200, { ticketIds: [IDS.t1] }));
    await app.ready;
    app.view(<TicketLinkScreen token={TOKEN} />);
    expect(screen.getByTestId('loading')).toBeOnTheScreen();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({ pathname: '/tickets/[id]', params: { id: IDS.t1 } }),
    );
    expect(app.server.callsTo('GET /v1/me/ticket-links/:token')[0]?.path).toBe(
      `/v1/me/ticket-links/${encodeURIComponent(TOKEN)}`,
    );
  });

  it('lists several tickets of the same event to choose from', async () => {
    const app = mount();
    app.server.on('GET /v1/me/ticket-links/:token', () => json(200, { ticketIds: [IDS.t1, IDS.t2] }));
    await app.ready;
    app.view(<TicketLinkScreen token={TOKEN} />);
    fireEvent.press(await screen.findByRole('button', { name: 'General admission · Grace Hopper' }));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/tickets/[id]', params: { id: IDS.t2 } });
  });

  it('explains a link that opens nothing (expired, or sent to another address) and points to the tickets', async () => {
    const app = mount();
    app.server.on('GET /v1/me/ticket-links/:token', () => problem(404, 'not_found'));
    await app.ready;
    app.view(<TicketLinkScreen token={TOKEN} />);
    expect(await screen.findByTestId('link-not-found')).toHaveTextContent(/couldn’t open that ticket/);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Go to my tickets' }));
    expect(router.replace).toHaveBeenCalledWith('/tickets');
  });

  it('treats an empty answer the same way', async () => {
    const app = mount();
    app.server.on('GET /v1/me/ticket-links/:token', () => json(200, { ticketIds: [] }));
    await app.ready;
    app.view(<TicketLinkScreen token={TOKEN} />);
    expect(await screen.findByTestId('link-not-found')).toBeOnTheScreen();
  });

  it('offers a retry on a server error', async () => {
    const app = mount();
    let fail = true;
    app.server.on('GET /v1/me/ticket-links/:token', () =>
      fail ? problem(403, 'forbidden') : json(200, { ticketIds: [IDS.t1] }),
    );
    await app.ready;
    app.view(<TicketLinkScreen token={TOKEN} />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    fireEvent.press(retry);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({ pathname: '/tickets/[id]', params: { id: IDS.t1 } }),
    );
  });
});
