import { screen, waitFor } from 'expo-router/testing-library';
import { onPath, press, pressName, type } from './helpers/actions';
import { cores, fakeApple, fakeGoogle, renderApp } from './helpers/app';
import { BACKUP, CODE, createFakeServer, PASSWORD, TOTP } from './helpers/fake-server';
import { en } from './helpers/messages';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../src/auth/apple-button', () => require('./helpers/apple-button-mock'));
jest.mock('../src/auth/methods', () => ({ availableMethods: () => ({ apple: true, google: true }) }));
afterEach(() => {
  for (const c of cores.splice(0)) c.queryClient.clear();
});

const ADDRESS = 'ada@example.test';

async function toPassword(app: Awaited<ReturnType<typeof renderApp>>) {
  await onPath(app.view, '/welcome');
  await press('welcome-password');
  await onPath(app.view, '/password');
}

describe('password sign-in', () => {
  it('signs in and lands on Tickets', async () => {
    const app = await renderApp();
    await toPassword(app);
    type('password-email', ADDRESS);
    type('password-input', PASSWORD);
    await press('password-submit');
    await onPath(app.view, '/tickets');
    expect(app.server.to('POST', '/v1/auth/token')[0]?.body).toEqual({
      grantType: 'password',
      email: ADDRESS,
      password: PASSWORD,
    });
  });

  it('asks for both fields before it calls the server', async () => {
    const app = await renderApp();
    await toPassword(app);
    await press('password-submit');
    expect(screen.getByText(en.signIn.email.required)).toBeOnTheScreen();
    expect(screen.getByText(en.signIn.password.required)).toBeOnTheScreen();
    expect(app.server.calls.filter((c) => c.path === '/v1/auth/token')).toHaveLength(0);
  });

  it('says so when the email or password is wrong', async () => {
    const app = await renderApp();
    await toPassword(app);
    type('password-email', ADDRESS);
    type('password-input', 'nope');
    await press('password-submit');
    await waitFor(() =>
      expect(screen.getByText(en.core.signIn.failed.invalid_credentials)).toBeOnTheScreen(),
    );
    expect(app.view.getPathname()).toBe('/password');
  });

  it('hides the password until asked, and shows it on request', async () => {
    const app = await renderApp();
    await toPassword(app);
    expect(screen.getByTestId('password-input').props.secureTextEntry).toBe(true);
    await press('password-toggle');
    expect(screen.getByTestId('password-input').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: en.signIn.password.hide })).toBeOnTheScreen();
  });

  it('shows the minutes to wait when the server limits the attempts', async () => {
    const server = createFakeServer();
    server.config.tokenRateLimit = 15 * 60;
    const app = await renderApp({ server });
    await toPassword(app);
    type('password-email', ADDRESS);
    type('password-input', PASSWORD);
    await press('password-submit');
    await waitFor(() =>
      expect(screen.getByText('Too many attempts. Try again in 15 minutes.')).toBeOnTheScreen(),
    );
  });

  it('points people without a password to the email code', async () => {
    const app = await renderApp();
    await toPassword(app);
    await press('password-use-code');
    await onPath(app.view, '/email');
  });

  describe('with two-step verification', () => {
    async function toSecondStep() {
      const server = createFakeServer();
      server.config.twoFactor = true;
      const app = await renderApp({ server });
      await toPassword(app);
      type('password-email', ADDRESS);
      type('password-input', PASSWORD);
      await press('password-submit');
      await onPath(app.view, '/two-factor');
      return app;
    }

    it('asks for the authenticator code after the password and signs in with it', async () => {
      const app = await toSecondStep();
      expect(app.core.session.state.status).toBe('signedOut');
      type('two-factor-input', TOTP);
      await press('two-factor-submit');
      await onPath(app.view, '/tickets');
      expect(app.server.grants()).toEqual(['password', 'two_factor']);
      expect(app.server.to('POST', '/v1/auth/token')[1]?.body).toMatchObject({
        grantType: 'two_factor',
        code: TOTP,
      });
    });

    it('accepts a backup code in the same field', async () => {
      const app = await toSecondStep();
      type('two-factor-input', BACKUP);
      await press('two-factor-submit');
      await onPath(app.view, '/tickets');
    });

    it('says a wrong code is wrong and lets the person try again', async () => {
      const app = await toSecondStep();
      type('two-factor-input', '000000');
      await press('two-factor-submit');
      await waitFor(() => expect(screen.getByText(en.core.signIn.failed.invalid_code)).toBeOnTheScreen());
      type('two-factor-input', TOTP);
      await press('two-factor-submit');
      await onPath(app.view, '/tickets');
    });

    it('asks for a code before it calls the server', async () => {
      const app = await toSecondStep();
      await press('two-factor-submit');
      expect(screen.getByText(en.signIn.twoFactor.required)).toBeOnTheScreen();
      expect(app.server.grants()).toEqual(['password']);
    });

    it('after five wrong codes the challenge is spent: start again from the welcome screen', async () => {
      const app = await toSecondStep();
      for (let i = 0; i < 5; i++) {
        type('two-factor-input', `00000${i}`);
        await press('two-factor-submit');
        await waitFor(() => expect(app.server.grants()).toHaveLength(2 + i));
      }
      await waitFor(() =>
        expect(screen.getByText(en.core.signIn.failed.too_many_attempts)).toBeOnTheScreen(),
      );
      await press('two-factor-start-over');
      await onPath(app.view, '/welcome');
    });

    it('goes back to the welcome screen when it is opened with no challenge', async () => {
      const app = await renderApp({ url: '/two-factor' });
      await onPath(app.view, '/welcome');
    });
  });
});

describe('sign in with Apple and Google', () => {
  it('Apple signs in through the sheet, sending the raw nonce and the first-time name', async () => {
    const app = await renderApp({ apple: fakeApple });
    await onPath(app.view, '/welcome');
    await pressName(en.welcome.apple);
    await onPath(app.view, '/tickets');
    const body = app.server.to('POST', '/v1/auth/token')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ grantType: 'apple', idToken: 'apple-ok', name: 'Ada' });
    expect(String(body.nonce)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Google signs in through its sheet', async () => {
    const app = await renderApp({ google: fakeGoogle });
    await onPath(app.view, '/welcome');
    await press('welcome-google');
    await onPath(app.view, '/tickets');
    expect(app.server.grants()).toEqual(['google']);
  });

  it('closing the sheet is not an error: the welcome screen just stays', async () => {
    const app = await renderApp({ google: { signIn: async () => null } });
    await onPath(app.view, '/welcome');
    await press('welcome-google');
    expect(app.server.grants()).toEqual([]);
    expect(screen.queryByTestId('welcome-error')).toBeNull();
    expect(app.view.getPathname()).toBe('/welcome');
  });

  it('a token the server refuses shows its own message', async () => {
    const app = await renderApp({ google: { signIn: async () => ({ idToken: 'bad-token' }) } });
    await onPath(app.view, '/welcome');
    await press('welcome-google');
    await waitFor(() => expect(screen.getByText(en.core.signIn.failed.invalid_id_token)).toBeOnTheScreen());
  });

  it('an account without an email shows that message', async () => {
    const app = await renderApp({
      apple: { isAvailable: async () => true, signIn: async () => ({ idToken: 'no-email' }) },
    });
    await onPath(app.view, '/welcome');
    await pressName(en.welcome.apple);
    await waitFor(() =>
      expect(screen.getByText(en.core.signIn.failed.provider_email_missing)).toBeOnTheScreen(),
    );
  });

  it('a phone where the sheet is not available says so', async () => {
    const app = await renderApp({ apple: { isAvailable: async () => false, signIn: async () => null } });
    await onPath(app.view, '/welcome');
    await pressName(en.welcome.apple);
    await waitFor(() => expect(screen.getByText(en.core.signIn.unsupported)).toBeOnTheScreen());
  });

  describe('when the address already has an account', () => {
    async function toProof(twoFactor = false) {
      const server = createFakeServer();
      server.config.providerEmailExists = true;
      server.config.twoFactor = twoFactor;
      const app = await renderApp({ server });
      await onPath(app.view, '/welcome');
      await press('welcome-google');
      await onPath(app.view, '/link-proof');
      return app;
    }

    it('asks for the emailed code, then signs in and links', async () => {
      const app = await toProof();
      expect(app.core.session.state.status).toBe('signedOut');
      type('link-proof-input', CODE);
      await onPath(app.view, '/tickets');
      expect(app.server.grants()).toEqual(['google', 'link_proof']);
    });

    it('a wrong code says it is wrong or expired', async () => {
      const app = await toProof();
      type('link-proof-input', '000000');
      await waitFor(() => expect(screen.getByText(en.signIn.code.wrongOrExpired)).toBeOnTheScreen());
      expect(app.view.getPathname()).toBe('/link-proof');
    });

    it('asks for all six digits', async () => {
      await toProof();
      type('link-proof-input', '12');
      await press('link-proof-submit');
      expect(screen.getByText(en.signIn.code.incomplete)).toBeOnTheScreen();
    });

    it('continues to the authenticator step when the account has one', async () => {
      const app = await toProof(true);
      type('link-proof-input', CODE);
      await onPath(app.view, '/two-factor');
      type('two-factor-input', TOTP);
      await press('two-factor-submit');
      await onPath(app.view, '/tickets');
      expect(app.server.grants()).toEqual(['google', 'link_proof', 'two_factor']);
    });

    it('goes back to the welcome screen when it is opened with no challenge', async () => {
      const app = await renderApp({ url: '/link-proof' });
      await onPath(app.view, '/welcome');
    });
  });
});
