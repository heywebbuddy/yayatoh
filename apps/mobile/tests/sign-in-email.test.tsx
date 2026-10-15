import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { onPath, press, type } from './helpers/actions';
import { cores, renderApp } from './helpers/app';
import { CODE, createFakeServer } from './helpers/fake-server';
import { en } from './helpers/messages';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../src/auth/apple-button', () => require('./helpers/apple-button-mock'));
afterEach(() => {
  for (const c of cores.splice(0)) c.queryClient.clear();
});

const ADDRESS = 'ada@example.test';

async function toCodeScreen(app: Awaited<ReturnType<typeof renderApp>>) {
  await onPath(app.view, '/welcome');
  await press('welcome-email');
  await onPath(app.view, '/email');
  type('email-input', ADDRESS);
  await press('email-submit');
  await onPath(app.view, '/code');
}

describe('email code sign-in', () => {
  it('goes from welcome through email and code to the Tickets tab', async () => {
    const app = await renderApp();
    await toCodeScreen(app);
    expect(app.server.to('POST', '/v1/auth/email-code')[0]?.body).toEqual({ email: ADDRESS });
    expect(
      screen.getByText(en.signIn.code.body.replace('{email}', ADDRESS).replace(/\{minutes.*$/, ''), {
        exact: false,
      }),
    ).toBeOnTheScreen();

    type('code-input', CODE);
    await onPath(app.view, '/tickets');
    expect(app.server.grants()).toEqual(['email_code']);
    expect(app.server.to('POST', '/v1/auth/token')[0]?.body).toEqual({
      grantType: 'email_code',
      email: ADDRESS,
      code: CODE,
    });
    expect(app.core.session.state.status).toBe('signedIn');
    // The tab bar is there with its three tabs.
    expect(screen.getByLabelText(new RegExp(`^${en.account.tabs.tickets}, tab`))).toBeOnTheScreen();
    expect(screen.getByLabelText(new RegExp(`^${en.account.tabs.discover}, tab`))).toBeOnTheScreen();
    expect(screen.getByLabelText(new RegExp(`^${en.account.tabs.account}, tab`))).toBeOnTheScreen();
  });

  it('signs in from the button as well as on the sixth digit', async () => {
    const app = await renderApp();
    await toCodeScreen(app);
    type('code-input', '123');
    await press('code-submit');
    expect(screen.getByText(en.signIn.code.incomplete)).toBeOnTheScreen();
    expect(app.server.grants()).toEqual([]);
  });

  it('asks for an address and refuses one that is not an address', async () => {
    const app = await renderApp();
    await onPath(app.view, '/welcome');
    await press('welcome-email');
    await onPath(app.view, '/email');
    await press('email-submit');
    expect(screen.getByText(en.signIn.email.required)).toBeOnTheScreen();
    type('email-input', 'not-an-address');
    await press('email-submit');
    expect(screen.getByText(en.signIn.email.invalid)).toBeOnTheScreen();
    expect(app.server.to('POST', '/v1/auth/email-code')).toHaveLength(0);
  });

  it('cleans a pasted code down to its digits and signs in', async () => {
    const app = await renderApp();
    await toCodeScreen(app);
    type('code-input', ' 123 456 ');
    await onPath(app.view, '/tickets');
  });

  it('offers the code to the keyboard as a one-time code (autofill) with a number pad', async () => {
    const app = await renderApp();
    await toCodeScreen(app);
    const input = screen.getByTestId('code-input');
    expect(input.props.textContentType).toBe('oneTimeCode');
    expect(input.props.autoComplete).toBe('sms-otp');
    expect(input.props.keyboardType).toBe('number-pad');
  });

  it('says a wrong code is wrong or expired, and lets the person try again', async () => {
    const app = await renderApp();
    await toCodeScreen(app);
    type('code-input', '000000');
    await waitFor(() => expect(screen.getByText(en.signIn.code.wrongOrExpired)).toBeOnTheScreen());
    expect(app.core.session.state.status).toBe('signedOut');
    expect(app.view.getPathname()).toBe('/code');
    type('code-input', '');
    type('code-input', CODE);
    await onPath(app.view, '/tickets');
  });

  it('gives an expired code the same message, since the server cannot tell them apart', async () => {
    const server = createFakeServer();
    server.config.codeExpired = true;
    const app = await renderApp({ server });
    await toCodeScreen(app);
    type('code-input', CODE);
    await waitFor(() => expect(screen.getByText(en.signIn.code.wrongOrExpired)).toBeOnTheScreen());
  });

  it('after too many wrong codes offers to start again, back at the email screen', async () => {
    const server = createFakeServer();
    server.config.codeAttemptsExhausted = true;
    const app = await renderApp({ server });
    await toCodeScreen(app);
    type('code-input', CODE);
    await waitFor(() => expect(screen.getByText(en.core.signIn.failed.too_many_attempts)).toBeOnTheScreen());
    await press('code-start-over');
    await onPath(app.view, '/email');
  });

  it('shows the time to wait when the server rate-limits the code, and holds resend back for it', async () => {
    const server = createFakeServer();
    server.config.tokenRateLimit = 5 * 60;
    const app = await renderApp({ server });
    await toCodeScreen(app);
    type('code-input', CODE);
    await waitFor(() =>
      expect(screen.getByText('Too many attempts. Try again in 5 minutes.')).toBeOnTheScreen(),
    );
    expect(screen.getByTestId('code-resend').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the rate limit on the request for a code, with the minutes to wait', async () => {
    const server = createFakeServer();
    server.config.emailCodeRateLimit = 14 * 60 + 30;
    const app = await renderApp({ server });
    await onPath(app.view, '/welcome');
    await press('welcome-email');
    type('email-input', ADDRESS);
    await press('email-submit');
    await waitFor(() =>
      expect(screen.getByText('Too many attempts. Try again in 15 minutes.')).toBeOnTheScreen(),
    );
    expect(app.view.getPathname()).toBe('/email');
  });

  it('tells the person when the network is down instead of failing silently', async () => {
    const server = createFakeServer();
    server.config.offline = true;
    const app = await renderApp({ server });
    await onPath(app.view, '/welcome');
    await press('welcome-email');
    type('email-input', ADDRESS);
    await press('email-submit');
    await waitFor(() => expect(screen.getByText(en.core.signIn.unavailable)).toBeOnTheScreen());
  });

  it('holds resend back for as long as the server asks when it limits the requests', async () => {
    const server = createFakeServer();
    const app = await renderApp({ server });
    await toCodeScreen(app);
    server.config.tokenRateLimit = 120;
    type('code-input', CODE);
    await waitFor(() =>
      expect(screen.getByText('Too many attempts. Try again in 2 minutes.')).toBeOnTheScreen(),
    );
    expect(screen.getByTestId('code-resend').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText(/^Send a new code in 1[12]\d seconds$/)).toBeOnTheScreen();
  });

  it('lets the person change the address, going back to the email screen', async () => {
    const app = await renderApp();
    await toCodeScreen(app);
    await press('code-change-email');
    await onPath(app.view, '/email');
  });

  it('sends someone who opens the code screen with no address back to the email screen', async () => {
    const app = await renderApp({ url: '/code' });
    await onPath(app.view, '/email');
  });

  it('does not send the code twice when the sixth digit and the button both fire', async () => {
    const app = await renderApp();
    await toCodeScreen(app);
    type('code-input', CODE);
    fireEvent.press(screen.getByTestId('code-submit'));
    await onPath(app.view, '/tickets');
    expect(app.server.grants()).toEqual(['email_code']);
  });
});
