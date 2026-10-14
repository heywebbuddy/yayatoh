import { screen, waitFor } from 'expo-router/testing-library';
import { CACHE_FILE } from '../../../packages/mobile-core/src/cache/persister';
import { onPath, openTab, press, type } from './helpers/actions';
import { cores, renderApp } from './helpers/app';
import { BACKUP, CODE, createFakeServer, PASSWORD, USER } from './helpers/fake-server';
import { en } from './helpers/messages';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../src/auth/apple-button', () => require('./helpers/apple-button-mock'));
afterEach(() => {
  for (const c of cores.splice(0)) c.queryClient.clear();
});

async function toDelete(server = createFakeServer()) {
  const app = await renderApp({ signedIn: true, server });
  await onPath(app.view, '/tickets');
  await openTab(en.account.tabs.account);
  await onPath(app.view, '/account');
  await press('account-delete');
  await onPath(app.view, '/account/delete');
  return app;
}

async function toVerify(server = createFakeServer()) {
  const app = await toDelete(server);
  await press('delete-continue');
  await waitFor(() => expect(screen.getByTestId('delete-proof')).toBeOnTheScreen());
  return app;
}

const submit = async (proof: string, email: string = USER.email) => {
  type('delete-proof', proof);
  type('delete-email', email);
  await press('delete-submit');
};

describe('the explanation', () => {
  it('says what is deleted and what organizers keep, before anything is asked', async () => {
    await toDelete();
    expect(screen.getByText(en.account.delete.intro)).toBeOnTheScreen();
    for (const key of ['deleted1', 'deleted2', 'deleted3', 'kept'] as const)
      expect(screen.getByText(en.account.delete[key])).toBeOnTheScreen();
    expect(screen.getByText(en.account.delete.deletedTitle)).toBeOnTheScreen();
    expect(screen.getByText(en.account.delete.keptTitle)).toBeOnTheScreen();
  });

  it('calls nothing on the server until the person continues', async () => {
    const app = await toDelete();
    expect(app.server.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(app.server.to('POST', '/v1/auth/step-up/start')).toHaveLength(0);
  });

  it('is not reachable when signed out', async () => {
    const app = await renderApp({ url: '/account/delete' });
    await onPath(app.view, '/welcome');
  });

  it('says so when the step-up cannot be started (offline)', async () => {
    const server = createFakeServer();
    const app = await toDelete(server);
    server.config.offline = true;
    await press('delete-continue');
    await waitFor(() => expect(screen.getByText(en.account.delete.unavailable)).toBeOnTheScreen());
    expect(app.core.session.state.status).toBe('signedIn');
  });
});

describe('confirming and deleting', () => {
  it('emailed code: step up, then delete, then sign out, wipe, and show the deleted page', async () => {
    const app = await toVerify();
    expect(screen.getByText(`We emailed a 6-digit code to ${USER.email}. Enter it here.`)).toBeOnTheScreen();
    app.core.queryClient.setQueryData(['tickets'], [{ id: 'cached' }]);
    await app.core.persister.persistClient({
      timestamp: Date.now(),
      buster: 'b',
      clientState: { mutations: [], queries: [] },
    });
    expect(app.files.files.has(CACHE_FILE)).toBe(true);

    await submit(CODE);
    await onPath(app.view, '/account/deleted');
    expect(screen.getByText(en.account.deleted.title)).toBeOnTheScreen();

    // In this order: the step-up, then the deletion, with the person's own token.
    const paths = app.server.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths.indexOf('POST /v1/auth/step-up')).toBeGreaterThan(
      paths.indexOf('POST /v1/auth/step-up/start'),
    );
    expect(paths.indexOf('DELETE /v1/me')).toBeGreaterThan(paths.indexOf('POST /v1/auth/step-up'));
    expect(app.server.to('POST', '/v1/auth/step-up')[0]?.body).toEqual({ method: 'email', code: CODE });
    expect(app.server.to('DELETE', '/v1/me')[0]?.authorization).toBe('Bearer access-1');

    // The phone holds no tokens and no cache.
    expect(app.core.session.state.status).toBe('signedOut');
    expect(app.storage.data.size).toBe(0);
    expect(app.files.files.has(CACHE_FILE)).toBe(false);
    expect(app.core.queryClient.getQueryData(['tickets'])).toBeUndefined();
  });

  it('the deleted page leads back to the welcome screen', async () => {
    const app = await toVerify();
    await submit(CODE);
    await onPath(app.view, '/account/deleted');
    await press('account-deleted-done');
    await onPath(app.view, '/welcome');
  });

  it('password account: asks for the password', async () => {
    const server = createFakeServer();
    server.config.stepUpMethod = 'password';
    const app = await toVerify(server);
    expect(screen.getByText(en.account.delete.stepUpPassword)).toBeOnTheScreen();
    expect(screen.getByTestId('delete-proof').props.secureTextEntry).toBe(true);
    await submit(PASSWORD);
    await onPath(app.view, '/account/deleted');
    expect(app.server.to('POST', '/v1/auth/step-up')[0]?.body).toEqual({
      method: 'password',
      password: PASSWORD,
    });
  });

  it('authenticator account: takes an authenticator or a backup code', async () => {
    const server = createFakeServer();
    server.config.stepUpMethod = 'totp';
    const app = await toVerify(server);
    expect(screen.getByText(en.account.delete.stepUpTotp)).toBeOnTheScreen();
    await submit(BACKUP);
    await onPath(app.view, '/account/deleted');
    expect(app.server.to('POST', '/v1/auth/step-up')[0]?.body).toEqual({ method: 'totp', code: BACKUP });
  });

  it('asks for the proof and for the address, with a message for each, and calls nothing', async () => {
    const app = await toVerify();
    await press('delete-submit');
    expect(screen.getByText(en.account.delete.proofRequired)).toBeOnTheScreen();
    expect(screen.getByText(en.account.delete.emailRequired)).toBeOnTheScreen();
    expect(app.server.to('POST', '/v1/auth/step-up')).toHaveLength(0);
  });

  it('refuses an address that is not the account’s, ignoring case and spaces for the right one', async () => {
    const app = await toVerify();
    await submit(CODE, 'someone.else@example.test');
    expect(screen.getByText(en.account.delete.mismatch)).toBeOnTheScreen();
    expect(app.server.to('POST', '/v1/auth/step-up')).toHaveLength(0);
    type('delete-email', `  ${USER.email.toUpperCase()}  `);
    await press('delete-submit');
    await onPath(app.view, '/account/deleted');
  });

  it('a wrong code or password shows its message and deletes nothing', async () => {
    const app = await toVerify();
    await submit('000000');
    await waitFor(() => expect(screen.getByText(en.core.signIn.failed.invalid_code)).toBeOnTheScreen());
    expect(app.server.to('DELETE', '/v1/me')).toHaveLength(0);
    expect(app.core.session.state.status).toBe('signedIn');
  });

  it('a wrong password has its own message', async () => {
    const server = createFakeServer();
    server.config.stepUpMethod = 'password';
    const app = await toVerify(server);
    await submit('wrong password');
    await waitFor(() => expect(screen.getByText(en.core.stepUp.invalid_password)).toBeOnTheScreen());
    expect(app.server.to('DELETE', '/v1/me')).toHaveLength(0);
  });

  it('if the confirmation lapses before the deletion, says so, keeps what was typed and the account', async () => {
    const server = createFakeServer();
    server.config.stepUpLapses = true;
    const app = await toVerify(server);
    await submit(CODE);
    await waitFor(() => expect(screen.getByText(en.account.delete.stepUpExpired)).toBeOnTheScreen());
    expect(app.core.session.state.status).toBe('signedIn');
    expect(app.view.getPathname()).toBe('/account/delete');
    expect(screen.getByTestId('delete-email').props.value).toBe(USER.email);
    // Confirming again (a fresh step-up) lets the deletion through.
    server.config.stepUpLapses = false;
    await press('delete-submit');
    await onPath(app.view, '/account/deleted');
  });

  it('the only owner of an organization is told which one, back on the explanation, and keeps the account', async () => {
    const server = createFakeServer();
    server.config.soleOwnerOf = ['Alpha Events', 'Bravo Weddings'];
    const app = await toVerify(server);
    await submit(CODE);
    await waitFor(() => expect(screen.getByTestId('delete-blockers')).toBeOnTheScreen());
    expect(screen.getByText(/Alpha Events, Bravo Weddings/)).toBeOnTheScreen();
    expect(screen.getByText(/the only owner of these organizations/)).toBeOnTheScreen();
    expect(app.core.session.state.status).toBe('signedIn');
    expect(app.view.getPathname()).toBe('/account/delete');
  });

  it('one organization reads in the singular', async () => {
    const server = createFakeServer();
    server.config.soleOwnerOf = ['Alpha Events'];
    await toVerify(server);
    await submit(CODE);
    await waitFor(() =>
      expect(screen.getByText(/the only owner of this organization: Alpha Events/)).toBeOnTheScreen(),
    );
  });

  it('when the phone is offline nothing is deleted and the person is told', async () => {
    const server = createFakeServer();
    const app = await toVerify(server);
    server.config.offline = true;
    await submit(CODE);
    await waitFor(() => expect(screen.getByText(en.core.signIn.unavailable)).toBeOnTheScreen());
    expect(app.core.session.state.status).toBe('signedIn');
    expect(app.view.getPathname()).toBe('/account/delete');
  });

  it('can go back from the confirmation to the explanation', async () => {
    await toVerify();
    await press('delete-back');
    expect(screen.getByTestId('delete-continue')).toBeOnTheScreen();
  });

  it('the deleted page is shown to a signed-out phone, and nothing else under Account is', async () => {
    const app = await renderApp({ url: '/account/deleted' });
    await onPath(app.view, '/account/deleted');
    expect(screen.getByText(en.account.deleted.title)).toBeOnTheScreen();
    const other = await renderApp({ url: '/account/language' });
    await onPath(other.view, '/welcome');
  });
});
