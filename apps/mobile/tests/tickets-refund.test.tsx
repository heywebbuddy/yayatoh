import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { YayatohApiError } from '@yayatoh/sdk';
import { viewProblem } from '../src/tickets/api';
import { RefundPanel, RefundScreen, refundErrorKey } from '../src/tickets/screens/refund';
import { setOnline, setup, teardown } from './helpers/tickets-app';
import { IDS, order, ticket } from './helpers/tickets-fixtures';
import { resetRouter, router } from './helpers/tickets-router-mock';
import { json, problem } from './helpers/tickets-server';

jest.mock('expo-router', () => require('./helpers/tickets-router-mock').routerMock);

const apps: ReturnType<typeof setup>[] = [];
function mount(o = order(), over: Parameters<typeof setup>[0] = {}) {
  const app = setup(over);
  apps.push(app);
  app.server.on('GET /v1/me/tickets/:id', () => ticket());
  app.server.on('GET /v1/me/orders/:id', () => o);
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
  app.view(<RefundScreen id={IDS.t1} />);
  return screen.findByTestId('refund-panel');
};
const problemOf = (status: number, code: string, details: Record<string, unknown> = {}, retry?: string) =>
  viewProblem(
    new YayatohApiError(new Response(null, { status, headers: retry ? { 'retry-after': retry } : {} }), {
      type: 'x',
      title: code,
      status,
      code,
      details,
    }),
  );

describe('refundErrorKey', () => {
  it('maps the server’s stable codes to messages', () => {
    expect(refundErrorKey(viewProblem(new TypeError('x')))).toBe('common.network');
    expect(refundErrorKey(problemOf(429, 'rate_limited', {}, '10'))).toBe('common.rateLimited');
    expect(refundErrorKey(problemOf(403, 'forbidden', { reason: 'email_unverified' }))).toBe(
      'common.verifyEmail',
    );
    expect(refundErrorKey(problemOf(404, 'not_found'))).toBe('common.notFoundTitle');
    expect(refundErrorKey(problemOf(409, 'invalid_state', { reason: 'request_open' }))).toBe(
      'refund.alreadyOpen',
    );
    expect(refundErrorKey(problemOf(409, 'invalid_state', { reason: 'policy_window_closed' }))).toBe(
      'refund.noLonger',
    );
    expect(refundErrorKey(problemOf(409, 'invalid_state', { reason: 'policy_no_refunds' }))).toBe(
      'refund.noLonger',
    );
    expect(refundErrorKey(problemOf(400, 'validation_failed'))).toBe('refund.pickOne');
    expect(refundErrorKey(problemOf(500, 'internal'))).toBe('refund.failed');
  });
});

describe('Refund request', () => {
  it('shows the refund policy the order was bought under, with the deadline and the retained fee', async () => {
    const app = mount();
    await open(app);
    expect(screen.getByTestId('refund-policy')).toHaveTextContent(
      /Refunds can be requested until Feb 22, 2030, 1:00 PM/,
    );
    expect(screen.getByText('$1.00 is kept as a fee.')).toBeOnTheScreen();
  });

  it.each([
    [{ kind: 'none', daysBefore: null, retainedMinor: 0, deadline: null }, /bought with no refunds/],
    [{ kind: 'always', daysBefore: null, retainedMinor: 0, deadline: null }, /any time before the event/],
    [{ kind: 'until', daysBefore: 7, retainedMinor: 0, deadline: null }, /up to 7 days before the event/],
  ] as const)('describes policy %j', async (patch, text) => {
    const o = order();
    const app = mount({ ...o, refundPolicy: { ...o.refundPolicy, ...patch } } as never);
    await open(app);
    expect(screen.getByTestId('refund-policy')).toHaveTextContent(text);
    expect(screen.queryByText(/is kept as a fee/)).toBeNull();
  });

  it('asks for all the tickets by default, with an idempotency key, and says the request was sent', async () => {
    const app = mount();
    app.server.on('POST /v1/me/orders/:id/refund-requests', () =>
      json(201, {
        status: 'open',
        tickets: 2,
        createdAt: '2030-02-01T12:00:00Z',
        decidedAt: null,
        declineReason: null,
      }),
    );
    await open(app);
    expect(screen.getByRole('switch', { name: /^Ticket 1/ })).toBeOnTheScreen();
    fireEvent.changeText(screen.getByTestId('refund-message'), '  Cannot make it  ');
    fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByTestId('refund-sent')).toHaveTextContent(/five business days/);
    const [call] = app.server.callsTo('POST /v1/me/orders/:id/refund-requests');
    // Every ticket chosen is sent as "all" (an empty list), which the API reads as all you hold.
    expect(call?.body).toEqual({ ticketIds: [], message: 'Cannot make it' });
    expect(call?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    // The order is read again for its new status.
    await waitFor(() => expect(app.server.callsTo('GET /v1/me/orders/:id').length).toBeGreaterThan(1));
  });

  it('sends only the tickets that stay switched on', async () => {
    const app = mount();
    app.server.on('POST /v1/me/orders/:id/refund-requests', () =>
      json(201, {
        status: 'open',
        tickets: 1,
        createdAt: '2030-02-01T12:00:00Z',
        decidedAt: null,
        declineReason: null,
      }),
    );
    await open(app);
    fireEvent(screen.getByTestId('refund-ticket-1'), 'valueChange', false);
    fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByTestId('refund-sent');
    expect(app.server.callsTo('POST /v1/me/orders/:id/refund-requests')[0]?.body).toEqual({
      ticketIds: [IDS.t1],
    });
  });

  it('will not send without a ticket chosen, or with a message that is too long', async () => {
    const app = mount();
    await open(app);
    fireEvent(screen.getByTestId('refund-ticket-0'), 'valueChange', false);
    fireEvent(screen.getByTestId('refund-ticket-1'), 'valueChange', false);
    fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByTestId('pick-one-error')).toHaveTextContent('Choose at least one ticket.');
    fireEvent(screen.getByTestId('refund-ticket-0'), 'valueChange', true);
    fireEvent.changeText(screen.getByTestId('refund-message'), 'x'.repeat(1050));
    fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText('Use 1000 characters or fewer.')).toBeOnTheScreen();
    expect(app.server.callsTo('POST /v1/me/orders/:id/refund-requests')).toHaveLength(0);
  });

  it.each([
    [409, 'invalid_state', { reason: 'policy_window_closed' }, /can’t be requested for this order any more/],
    [409, 'invalid_state', { reason: 'request_open' }, /already waiting/],
    [429, 'rate_limited', {}, /Wait 12 seconds/],
    [500, 'internal', {}, /couldn’t send the request/],
  ] as const)('shows the server’s answer %s %j in words', async (status, code, details, text) => {
    const app = mount();
    app.server.on('POST /v1/me/orders/:id/refund-requests', () =>
      problem(
        status,
        code,
        details as Record<string, unknown>,
        status === 429 ? { 'retry-after': '12' } : {},
      ),
    );
    await open(app);
    fireEvent.press(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByTestId('refund-error')).toHaveTextContent(text);
  });

  it('shows the latest request’s status: open, approved, declined with its reason', async () => {
    const o = order();
    const cases = [
      [
        {
          status: 'open',
          tickets: 2,
          createdAt: '2030-02-01T12:00:00Z',
          decidedAt: null,
          declineReason: null,
        },
        /Waiting for the organizer/,
      ],
      [
        {
          status: 'approved',
          tickets: 1,
          createdAt: '2030-02-01T12:00:00Z',
          decidedAt: '2030-02-03T15:00:00Z',
          declineReason: null,
        },
        /Approved Feb 3, 2030, 9:00 AM/,
      ],
      [
        {
          status: 'declined',
          tickets: 1,
          createdAt: '2030-02-01T12:00:00Z',
          decidedAt: '2030-02-03T15:00:00Z',
          declineReason: 'Past the cut-off',
        },
        /Declined Feb 3, 2030/,
      ],
    ] as const;
    for (const [latest, text] of cases) {
      const app = mount({
        ...o,
        refundRequest: {
          latest,
          canRequest: latest.status === 'declined',
          refusal: latest.status === 'open' ? 'request_open' : null,
          deadline: null,
        },
      } as never);
      await open(app);
      expect(screen.getByTestId('refund-latest')).toHaveTextContent(text);
      if (latest.status === 'declined')
        expect(screen.getByText('Reason: Past the cut-off')).toBeOnTheScreen();
      if (latest.status === 'open') {
        expect(screen.queryByTestId('refund-form')).toBeNull();
        expect(screen.getByTestId('refund-refusal')).toHaveTextContent(
          'You already have a request waiting for an answer.',
        );
      }
      screen.unmount();
    }
  });

  it.each([
    ['policy_no_refunds', /doesn’t allow refund requests/],
    ['policy_window_closed', /window to ask for a refund has closed/],
  ] as const)('explains why a refund cannot be requested: %s', async (refusal, text) => {
    const o = order();
    const app = mount({
      ...o,
      refundRequest: { latest: null, canRequest: false, refusal, deadline: null },
    } as never);
    await open(app);
    expect(screen.getByTestId('refund-refusal')).toHaveTextContent(text);
    expect(screen.queryByTestId('refund-form')).toBeNull();
  });

  it('shows loading, then an error with a retry when the order cannot be read', async () => {
    const app = mount();
    let fail = true;
    app.server.on('GET /v1/me/orders/:id', () => (fail ? problem(403, 'forbidden') : order()));
    await app.ready;
    app.view(<RefundScreen id={IDS.t1} />);
    expect(screen.getByTestId('loading')).toBeOnTheScreen();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    fireEvent.press(retry);
    expect(await screen.findByTestId('refund-panel')).toBeOnTheScreen();
  });

  it('says it is offline when nothing is saved and the connection is down', async () => {
    const app = mount();
    app.server.offline = true;
    setOnline(false);
    await app.ready;
    app.view(<RefundScreen id={IDS.t1} />);
    expect(await screen.findByTestId('refund-error', {}, { timeout: 5000 })).toBeOnTheScreen();
  });

  it('can be embedded by the order screen: RefundPanel takes the order', async () => {
    const app = mount();
    await app.ready;
    app.view(<RefundPanel order={order()} />);
    expect(await screen.findByTestId('refund-form')).toBeOnTheScreen();
  });

  it('goes back', async () => {
    const app = mount();
    await open(app);
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
  });
});
