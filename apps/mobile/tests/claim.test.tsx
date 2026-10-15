import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { YayatohApiError } from '@yayatoh/sdk';
import { viewProblem } from '../src/tickets/api';
import { PENDING_KEY } from '../src/tickets/pending';
import { ClaimScreen, claimFailure } from '../src/tickets/screens/claim';
import { setOnline, setup, teardown } from './helpers/app';
import { claimDetails, IDS, ticket } from './helpers/fixtures';
import { resetRouter, router } from './helpers/router-mock';
import { json, problem } from './helpers/server';

jest.mock('expo-router', () => require('./helpers/router-mock').routerMock);

const TOKEN = 'claimtoken-abcdef123456';
const apps: ReturnType<typeof setup>[] = [];
function mount(details: unknown = claimDetails(), over: Parameters<typeof setup>[0] = {}) {
  const app = setup(over);
  apps.push(app);
  app.server.on('GET /v1/claims/:token', () => details);
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
  app.view(<ClaimScreen token={TOKEN} />);
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

describe('claimFailure', () => {
  it('tells an address mismatch, a link’s state and everything else apart', () => {
    expect(
      claimFailure(problemOf(400, 'validation_failed', { reason: 'email_mismatch', field: 'email' })),
    ).toEqual({ kind: 'mismatch' });
    for (const state of ['claimed', 'revoked', 'expired'] as const)
      expect(claimFailure(problemOf(409, 'invalid_state', { state }))).toEqual({ kind: 'state', state });
    expect(claimFailure(viewProblem(new TypeError('x')))).toEqual({ kind: 'message', key: 'common.network' });
    expect(claimFailure(problemOf(429, 'rate_limited', {}, '5'))).toEqual({
      kind: 'message',
      key: 'common.rateLimited',
      seconds: 5,
    });
    expect(claimFailure(problemOf(429, 'rate_limited'))).toEqual({
      kind: 'message',
      key: 'common.rateLimitedNoTime',
    });
    expect(claimFailure(problemOf(403, 'forbidden', { reason: 'email_unverified' }))).toEqual({
      kind: 'message',
      key: 'claim.unverified',
    });
    expect(claimFailure(problemOf(404, 'not_found'))).toEqual({ kind: 'message', key: 'claim.invalid' });
    expect(claimFailure(problemOf(500, 'internal'))).toEqual({ kind: 'message', key: 'claim.failed' });
  });
});

describe('Claim a ticket', () => {
  it('asks a signed-out person to sign in, remembers the link, and sends them to sign-in', async () => {
    const app = mount(claimDetails(), { signedIn: false });
    await open(app);
    expect(await screen.findByTestId('claim-sign-in')).toBeOnTheScreen();
    expect(screen.getByText('Sign in to claim this ticket')).toBeOnTheScreen();
    // Nothing about the ticket is fetched without a session.
    expect(app.server.callsTo('GET /v1/claims/:token')).toHaveLength(0);
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/welcome'));
    expect(JSON.parse((await app.storage.get(PENDING_KEY)) ?? '{}')).toMatchObject({
      kind: 'claim',
      token: TOKEN,
    });
  });

  it('shows what is being claimed from a transfer: who sent it, the event, type, time zone and organizer', async () => {
    const app = mount();
    await open(app);
    expect(await screen.findByTestId('claim-offer')).toHaveTextContent(
      /Grace Hopper sent you a ticket for Summer Night\./,
    );
    expect(screen.getByText('This transfer is for Ada Lovelace.')).toBeOnTheScreen();
    expect(screen.getByText(/Fri, Mar 1, 2030, 1:00 PM – 5:00 PM (CST|GMT-6)/)).toBeOnTheScreen();
    expect(screen.getByText('Lakeside Events')).toBeOnTheScreen();
    expect(screen.getByTestId('signed-in-as')).toHaveTextContent('Signed in as ada@example.test');
  });

  it('shows a plain claim link without a sender', async () => {
    const app = mount(claimDetails({ transfer: null }));
    await open(app);
    expect(await screen.findByTestId('claim-offer')).toHaveTextContent(
      /Lakeside Events has a ticket for you to Summer Night\./,
    );
  });

  it('claims with the name on the ticket (the account’s by default), once per key, then offers the ticket', async () => {
    const app = mount();
    app.server.on('POST /v1/claims/:token', () => json(200, ticket()));
    await open(app);
    const name = await screen.findByTestId('claim-name');
    await waitFor(() => expect(name.props.value).toBe('Ada'));
    fireEvent.press(screen.getByRole('button', { name: 'Claim ticket' }));
    expect(await screen.findByTestId('claim-success')).toHaveTextContent(
      /General admission for Summer Night is now in your tickets/,
    );
    const [call] = app.server.callsTo('POST /v1/claims/:token');
    expect(call?.path).toBe(`/v1/claims/${TOKEN}`);
    expect(call?.body).toEqual({ name: 'Ada' });
    expect(call?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    // The claimed ticket is in the saved copy already.
    expect(app.core.queryClient.getQueryData(['tickets', 'detail', IDS.t1])).toBeDefined();
    fireEvent.press(screen.getByRole('button', { name: 'View ticket' }));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/tickets/[id]', params: { id: IDS.t1 } });
  });

  it('needs a name on the ticket', async () => {
    const app = mount();
    await open(app);
    const name = await screen.findByTestId('claim-name');
    await waitFor(() => expect(name.props.value).toBe('Ada'));
    fireEvent.changeText(name, '   ');
    fireEvent.press(screen.getByRole('button', { name: 'Claim ticket' }));
    expect(screen.getByText('Enter the name for the ticket.')).toBeOnTheScreen();
    expect(app.server.callsTo('POST /v1/claims/:token')).toHaveLength(0);
  });

  it('explains which address the ticket was sent for when the signed-in address is a different one', async () => {
    const app = mount();
    app.server.on('POST /v1/claims/:token', () =>
      problem(400, 'validation_failed', { reason: 'email_mismatch', field: 'email' }),
    );
    await open(app);
    await screen.findByTestId('claim-offer');
    fireEvent.press(screen.getByRole('button', { name: 'Claim ticket' }));
    const card = await screen.findByTestId('claim-mismatch');
    expect(card).toHaveTextContent(/This ticket was sent to a different email address/);
    expect(card).toHaveTextContent(
      /It was sent for Ada Lovelace, and you are signed in as ada@example\.test\./,
    );
    // Switching account remembers the link, signs out, and the sign-in flow brings the person back.
    fireEvent.press(screen.getByRole('button', { name: 'Use a different account' }));
    await waitFor(() => expect(app.core.session.state.status).toBe('signedOut'));
    expect(JSON.parse((await app.storage.get(PENDING_KEY)) ?? '{}')).toMatchObject({
      kind: 'claim',
      token: TOKEN,
    });
  });

  it.each([
    ['claimed', 'This ticket has already been claimed'],
    ['revoked', 'The sender cancelled this transfer'],
    ['expired', 'This link has expired'],
  ] as const)('a %s link says so and offers no claim', async (state, title) => {
    const app = mount(claimDetails({ state }));
    await open(app);
    expect(await screen.findByText(title)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Claim ticket' })).toBeNull();
  });

  it('shows the state the server reports when the claim itself is refused (claimed meanwhile)', async () => {
    const app = mount();
    app.server.on('POST /v1/claims/:token', () => problem(409, 'invalid_state', { state: 'claimed' }));
    await open(app);
    await screen.findByTestId('claim-offer');
    fireEvent.press(screen.getByRole('button', { name: 'Claim ticket' }));
    expect(await screen.findByTestId('claim-claimed')).toBeOnTheScreen();
  });

  it('says a link is not valid (404) without a retry', async () => {
    const app = mount();
    app.server.on('GET /v1/claims/:token', () => problem(404, 'not_found'));
    await open(app);
    expect(await screen.findByTestId('claim-invalid')).toHaveTextContent(/This link isn’t valid/);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers a retry when the link cannot be read for another reason', async () => {
    const app = mount();
    let fail = true;
    app.server.on('GET /v1/claims/:token', () => (fail ? problem(500, 'internal') : claimDetails()));
    await open(app);
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 15000 });
    fail = false;
    fireEvent.press(retry);
    expect(await screen.findByTestId('claim-offer')).toBeOnTheScreen();
  }, 30000);

  it.each([
    [429, 'rate_limited', {}, /Wait 9 seconds/],
    [403, 'forbidden', { reason: 'email_unverified' }, /Verify your email address before claiming/],
    [500, 'internal', {}, /couldn’t claim the ticket/],
  ] as const)('shows the answer %s %s to a claim in words', async (status, code, details, text) => {
    const app = mount();
    app.server.on('POST /v1/claims/:token', () =>
      problem(status, code, details as Record<string, unknown>, status === 429 ? { 'retry-after': '9' } : {}),
    );
    await open(app);
    await screen.findByTestId('claim-offer');
    fireEvent.press(screen.getByRole('button', { name: 'Claim ticket' }));
    expect(await screen.findByTestId('claim-error')).toHaveTextContent(text);
  });

  it('is a loading screen until the session is known', async () => {
    const app = mount();
    app.view(<ClaimScreen token={TOKEN} />);
    expect(screen.getByTestId('loading')).toBeOnTheScreen();
    await app.ready;
    expect(await screen.findByTestId('claim-offer')).toBeOnTheScreen();
  });
});
