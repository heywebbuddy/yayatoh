import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { TransferScreen, transferErrorKey, validateTransfer } from '../src/tickets/screens/transfer';
import { viewProblem } from '../src/tickets/api';
import { YayatohApiError } from '@yayatoh/sdk';
import { fakeServices, setOnline, setup } from './helpers/app';
import { IDS, ticket } from './helpers/fixtures';
import { resetRouter, router } from './helpers/router-mock';
import { json, problem } from './helpers/server';

jest.mock('expo-router', () => require('./helpers/router-mock').routerMock);

const apps: ReturnType<typeof setup>[] = [];
function mount(over: Parameters<typeof setup>[0] = {}, t = ticket()) {
  const app = setup(over);
  apps.push(app);
  app.server.on('GET /v1/me/tickets/:id', () => t);
  app.server.on('GET /v1/me/tickets', () => ({ data: [], nextCursor: null }));
  return app;
}
beforeEach(() => {
  resetRouter();
  setOnline(true);
});
afterEach(() => {
  setOnline(true);
  for (const app of apps.splice(0)) app.core.queryClient.clear();
});

const fill = async (name: string, email: string) => {
  fireEvent.changeText(await screen.findByTestId('to-name'), name);
  fireEvent.changeText(screen.getByTestId('to-email'), email);
};
const open = async (app: ReturnType<typeof setup>) => {
  await app.ready;
  app.view(<TransferScreen id={IDS.t1} />);
  await screen.findByTestId('transfer-form');
};
const review = () => fireEvent.press(screen.getByRole('button', { name: 'Review transfer' }));
const send = () => fireEvent.press(screen.getByTestId('send'));

describe('validateTransfer', () => {
  it('needs a name of 1 to 120 characters and a valid email that is not your own', () => {
    expect(validateTransfer('', 'a@b.co', null)).toEqual({ name: 'nameRequired' });
    expect(validateTransfer('   ', 'a@b.co', null)).toEqual({ name: 'nameRequired' });
    expect(validateTransfer('x'.repeat(121), 'a@b.co', null)).toEqual({ name: 'nameTooLong' });
    expect(validateTransfer('x'.repeat(120), 'a@b.co', null)).toEqual({});
    expect(validateTransfer('Sam', 'not-an-email', null)).toEqual({ email: 'emailInvalid' });
    expect(validateTransfer('Sam', 'a@b', null)).toEqual({ email: 'emailInvalid' });
    expect(validateTransfer('Sam', `${'a'.repeat(250)}@b.co`, null)).toEqual({ email: 'emailInvalid' });
    expect(validateTransfer('Sam', ' Ada@Example.test ', 'ada@example.test')).toEqual({ email: 'emailIsYours' });
    expect(validateTransfer('', 'x', 'ada@example.test')).toEqual({ name: 'nameRequired', email: 'emailInvalid' });
  });
});

describe('transferErrorKey', () => {
  const api = (status: number, code: string, details: Record<string, unknown> = {}, retry?: string) =>
    viewProblem(
      new YayatohApiError(
        new Response(null, { status, headers: retry ? { 'retry-after': retry } : {} }),
        { type: 'x', title: code, status, code, details },
      ),
    );
  it('maps the server’s stable codes to messages', () => {
    expect(transferErrorKey(viewProblem(new TypeError('Network request failed')))).toBe('common.network');
    expect(transferErrorKey(api(429, 'rate_limited', {}, '30'))).toBe('common.rateLimited');
    expect(transferErrorKey(api(429, 'rate_limited'))).toBe('common.rateLimitedNoTime');
    expect(transferErrorKey(api(403, 'forbidden', { reason: 'email_unverified' }))).toBe('common.verifyEmail');
    expect(transferErrorKey(api(404, 'not_found'))).toBe('common.notFoundTitle');
    expect(transferErrorKey(api(400, 'validation_failed', { reason: 'same_holder' }))).toBe('transfer.sameHolder');
    expect(transferErrorKey(api(409, 'invalid_state', { reason: 'deadline_passed' }))).toBe(
      'detail.transferRefused.deadline_passed',
    );
    expect(transferErrorKey(api(409, 'invalid_state', {}))).toBe('transfer.invalidState');
    expect(transferErrorKey(api(500, 'internal'))).toBe('common.unexpected');
  });
});

describe('Transfer screen', () => {
  it('shows each validation error under its field and goes no further', async () => {
    const app = mount();
    await open(app);
    review();
    expect(screen.getByText('Enter the recipient’s name.')).toBeOnTheScreen();
    expect(screen.getByText('Enter a valid email address.')).toBeOnTheScreen();
    expect(screen.getByTestId('to-name')).toHaveAccessibleName('Recipient’s name');
    await fill('Sam Rivera', 'sam@@example');
    review();
    expect(screen.queryByText('Enter the recipient’s name.')).toBeNull();
    expect(screen.getByText('Enter a valid email address.')).toBeOnTheScreen();
    await fill('Sam Rivera', 'ada@example.test');
    review();
    expect(screen.getByText('That is your own email address.')).toBeOnTheScreen();
    expect(screen.queryByTestId('transfer-confirm')).toBeNull();
    expect(app.server.callsTo('POST /v1/me/tickets/:id/transfers')).toHaveLength(0);
  });

  it('asks to confirm, lets the person go back and edit, then sends once with an idempotency key', async () => {
    const app = mount();
    app.server.on('POST /v1/me/tickets/:id/transfers', () =>
      json(201, { status: 'started', transferId: IDS.transfer, feeMinor: 0, currency: 'USD', webUrl: null }),
    );
    await open(app);
    await fill('Sam Rivera', 'sam@example.test');
    review();
    expect(screen.getByText(/Transfer General admission · Summer Night to Sam Rivera \(sam@example.test\)\?/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.getByTestId('to-name').props.value).toBe('Sam Rivera');
    review();
    send();
    expect(await screen.findByTestId('transfer-sent')).toBeOnTheScreen();
    expect(screen.getByText(/Sam Rivera will get an email at sam@example.test/)).toBeOnTheScreen();
    const [call] = app.server.callsTo('POST /v1/me/tickets/:id/transfers');
    expect(call?.body).toEqual({ toName: 'Sam Rivera', toEmail: 'sam@example.test' });
    expect(call?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    // The lists are re-read so the pending transfer shows.
    await waitFor(() => expect(app.server.callsTo('GET /v1/me/tickets').length).toBeGreaterThan(0));
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('retries a request that never got an answer under the same idempotency key', async () => {
    const app = mount();
    app.server.on('POST /v1/me/tickets/:id/transfers', () =>
      json(201, { status: 'started', transferId: IDS.transfer, feeMinor: 0, currency: 'USD', webUrl: null }),
    );
    await open(app);
    await fill('Sam Rivera', 'sam@example.test');
    review();
    app.server.offline = true;
    send();
    expect(await screen.findByTestId('transfer-error')).toHaveTextContent(/couldn’t reach Yayatoh/);
    // Back on the form with what was typed.
    expect(screen.getByTestId('to-name').props.value).toBe('Sam Rivera');
    app.server.offline = false;
    review();
    send();
    expect(await screen.findByTestId('transfer-sent')).toBeOnTheScreen();
    const keys = app.server.callsTo('POST /v1/me/tickets/:id/transfers').map((c) => c.headers.get('idempotency-key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('a different recipient is a different request, with its own key', async () => {
    const app = mount();
    let n = 0;
    app.server.on('POST /v1/me/tickets/:id/transfers', () =>
      ++n === 1 ? problem(400, 'validation_failed', { reason: 'same_holder' }) : json(201, { status: 'started', transferId: IDS.transfer, feeMinor: 0, currency: 'USD', webUrl: null }),
    );
    await open(app);
    await fill('Sam Rivera', 'sam@example.test');
    review();
    send();
    expect(await screen.findByTestId('transfer-error')).toHaveTextContent('That person already holds this ticket.');
    await fill('Robin Lee', 'robin@example.test');
    review();
    send();
    await screen.findByTestId('transfer-sent');
    const [first, second] = app.server.callsTo('POST /v1/me/tickets/:id/transfers');
    expect(first?.headers.get('idempotency-key')).not.toBe(second?.headers.get('idempotency-key'));
  });

  it.each([
    [429, 'rate_limited', {}, /Wait 30 seconds/],
    [403, 'forbidden', { reason: 'email_unverified' }, /Verify your email address/],
    [409, 'invalid_state', { reason: 'deadline_passed' }, /Transfers closed/],
    [409, 'invalid_state', { reason: 'event_ended' }, /event is over/],
    [500, 'internal', {}, /Something went wrong/],
  ] as const)('shows the server’s answer %s %s in words', async (status, code, details, text) => {
    const app = mount();
    app.server.on('POST /v1/me/tickets/:id/transfers', () =>
      problem(status, code, details as Record<string, unknown>, status === 429 ? { 'retry-after': '30' } : {}),
    );
    await open(app);
    await fill('Sam Rivera', 'sam@example.test');
    review();
    send();
    expect(await screen.findByTestId('transfer-error')).toHaveTextContent(text);
  });

  it('sends a transfer with a fee to the web in the secure browser, and refreshes after', async () => {
    const fake = fakeServices();
    const app = mount(
      { services: fake.services },
      ticket({ transfer: { ...ticket().transfer, feeMinor: 350, currency: 'USD', feeRequiresWeb: true } }),
    );
    app.server.on('POST /v1/me/tickets/:id/transfers', () =>
      json(200, {
        status: 'web_payment_required',
        transferId: null,
        feeMinor: 350,
        currency: 'USD',
        webUrl: 'https://web.example.test/my-tickets/abc~def',
      }),
    );
    await open(app);
    await fill('Sam Rivera', 'sam@example.test');
    review();
    expect(screen.getByTestId('fee-notice')).toHaveTextContent(/This ticket type charges a transfer fee of \$3\.50\./);
    fireEvent.press(screen.getByRole('button', { name: 'Continue on the web' }));
    expect(await screen.findByTestId('transfer-web')).toBeOnTheScreen();
    expect(fake.log.web).toEqual(['https://web.example.test/my-tickets/abc~def']);
    // Nothing was started: no “sent” screen, and the lists are re-read when the browser closes.
    expect(screen.queryByTestId('transfer-sent')).toBeNull();
    await waitFor(() => expect(app.server.callsTo('GET /v1/me/tickets').length).toBeGreaterThan(0));
  });

  it('shows why a ticket cannot be transferred, with the deadline, and no form', async () => {
    const app = mount(
      {},
      ticket({ transfer: { ...ticket().transfer, allowed: false, reason: 'deadline_passed', deadline: '2030-02-28T18:00:00Z' } }),
    );
    await app.ready;
    app.view(<TransferScreen id={IDS.t1} />);
    expect(await screen.findByTestId('transfer-closed')).toHaveTextContent(/Transfers closed Feb 28, 2030, 12:00 PM/);
    expect(screen.queryByTestId('transfer-form')).toBeNull();
  });

  it('shows loading, and an error with a retry when the ticket cannot be read', async () => {
    const app = mount();
    let fail = true;
    app.server.on('GET /v1/me/tickets/:id', () => (fail ? problem(403, 'forbidden') : ticket()));
    await app.ready;
    app.view(<TransferScreen id={IDS.t1} />);
    expect(screen.getByTestId('loading')).toBeOnTheScreen();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    fireEvent.press(retry);
    expect(await screen.findByTestId('transfer-form')).toBeOnTheScreen();
  });

  it('goes back to the ticket', async () => {
    const app = mount();
    await open(app);
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
  });
});
