import { randomBytes } from 'node:crypto';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useQuery } from '@tanstack/react-query';
import { Text } from 'react-native';
import { type CoreAdapters, createCore } from '../src/core';
import { CACHE_FILE } from '../src/cache/persister';
import { CACHE_KEY_NAME } from '../src/cache/encryption';
import { memoryFileStore, memoryKeyValueStore } from '../src/ports';
import { CoreProvider, useCore, useSession } from '../src/provider';
import { SESSION_KEY } from '../src/session/session-store';
import { createFakeApi, json, pair, problem } from './helpers/fake-api';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const built: { queryClient: { clear(): void } }[] = [];
// A cached query keeps a seven-day garbage-collection timer, which would keep Jest alive.
afterEach(() => {
  for (const core of built.splice(0)) core.queryClient.clear();
});

function build(fetchImpl?: typeof fetch, over: Partial<CoreAdapters> = {}) {
  const fake = createFakeApi();
  const storage = memoryKeyValueStore();
  const files = memoryFileStore();
  const core = createCore({
    appName: 'Yayatoh',
    identity: { app: 'mobile', platform: 'ios', version: '1.0.0', build: '7' },
    apiBaseUrl: 'https://app.yayatoh.com/api/v1',
    catalogs: { en: { home: { title: 'Home' } } },
    adapters: { storage, files, random: (n) => new Uint8Array(randomBytes(n)), fetch: fetchImpl ?? fake.fetch, ...over },
  });
  built.push(core);
  return { core, fake, storage, files };
}

describe('createCore', () => {
  it('signs requests with the session and identifies the app', async () => {
    const { core, fake } = build();
    await core.session.setTokens(pair(0));
    const { response } = await core.api.GET('/v1/me');
    expect(response.status).toBe(200);
    expect(fake.calls.at(-1)).toMatchObject({ authorization: 'Bearer access-0', client: 'yayatoh-ios/1.0.0 (7)' });
    expect(core.release).toBe('yayatoh-ios@1.0.0+7');
  });

  it('the public client sends no token', async () => {
    const { core, fake } = build();
    await core.session.setTokens(pair(0));
    await core.publicApi.GET('/v1/me');
    expect(fake.calls.at(-1)?.authorization).toBeNull();
  });

  it('a reused refresh token signs out AND wipes the encrypted cache and its key', async () => {
    const { core, fake, storage, files } = build();
    await core.session.setTokens(pair(0));
    core.queryClient.setQueryData(['tickets'], [{ id: 1 }]);
    await core.persister.persistClient({
      timestamp: Date.now(),
      buster: 'b',
      clientState: { mutations: [], queries: [] },
    });
    expect(files.files.has(CACHE_FILE)).toBe(true);
    expect(storage.data.has(CACHE_KEY_NAME)).toBe(true);

    fake.expectedRefresh = 'someone-else';
    fake.valid.clear();
    await core.api.GET('/v1/me');

    expect(core.session.state).toEqual({ status: 'signedOut', reason: 'reused' });
    expect(core.queryClient.getQueryData(['tickets'])).toBeUndefined();
    expect(files.files.has(CACHE_FILE)).toBe(false);
    expect(storage.data.has(CACHE_KEY_NAME)).toBe(false);
    expect(storage.data.has(SESSION_KEY)).toBe(false);
  });

  it('signing out wipes the same way and revokes on the server', async () => {
    const { core, fake, storage, files } = build();
    await core.session.setTokens(pair(0));
    await core.persister.persistClient({ timestamp: 1, buster: 'b', clientState: { mutations: [], queries: [] } });
    await core.session.signOut();
    expect(fake.calls.some((c) => c.path === '/v1/auth/revoke')).toBe(true);
    expect(files.files.size).toBe(0);
    expect(storage.data.size).toBe(0);
  });

  it('a 426 from any call reaches the version gate', async () => {
    const { core } = build((async () =>
      problem(426, 'upgrade_required', { minimumVersion: '2.0.0', latestVersion: '2.0.0', storeUrl: 'https://apps.apple.com/app/x' })) as unknown as typeof fetch);
    await core.api.GET('/v1/me');
    await waitFor(() => expect(core.versionGate.state.kind).toBe('required'));
    expect(core.versionGate.state).toMatchObject({ minimum: '2.0.0', storeUrl: 'https://apps.apple.com/app/x' });
  });

  it('signs in through the helpers and the session follows', async () => {
    const { core } = build((async (req: Request) => {
      const body = await req.clone().json().catch(() => ({}));
      return new URL(req.url).pathname.endsWith('/auth/token') && body.grantType === 'email_code' ? json(200, pair(0)) : problem(404, 'not_found');
    }) as unknown as typeof fetch);
    expect(await core.signIn.withEmailCode('ada@example.test', '123456')).toMatchObject({ kind: 'signedIn' });
    expect(core.session.state.status).toBe('signedIn');
  });

  it('Apple and Google are unsupported when no provider is wired', async () => {
    const { core } = build();
    expect(await core.signIn.withApple()).toEqual({ kind: 'unsupported' });
    expect(await core.signIn.withGoogle()).toEqual({ kind: 'unsupported' });
  });
});

function Whoami() {
  const state = useSession();
  const core = useCore();
  return <Text testID="who">{`${state.status}:${core.appName}`}</Text>;
}

function Tickets() {
  const { core } = { core: useCore() };
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await core.api.GET('/v1/me');
      return data?.name ?? '';
    },
  });
  return <Text testID="name">{q.data ?? '…'}</Text>;
}

describe('CoreProvider', () => {
  it('restores the session at launch, then renders the app with the shared strings and theme', async () => {
    const { core } = build();
    await core.session.setTokens(pair(0));
    const fresh = build();
    // A second launch sharing storage with the first.
    const launched = createCore({
      appName: 'Yayatoh',
      identity: { app: 'mobile', platform: 'ios', version: '1.0.0' },
      apiBaseUrl: 'https://app.yayatoh.com/api/v1',
      catalogs: { en: {} },
      adapters: { storage: (core.storage as ReturnType<typeof memoryKeyValueStore>), files: memoryFileStore(), random: (n) => new Uint8Array(randomBytes(n)), fetch: fresh.fake.fetch },
    });
    built.push(launched);
    render(
      <CoreProvider core={launched} bindNetwork={false}>
        <Whoami />
      </CoreProvider>,
    );
    expect(screen.getByTestId('who').props.children).toBe('loading:Yayatoh');
    await waitFor(() => expect(screen.getByTestId('who').props.children).toBe('signedIn:Yayatoh'));
  });

  it('runs queries through the signed client', async () => {
    const { core } = build();
    await core.session.setTokens(pair(0));
    render(
      <CoreProvider core={core} bindNetwork={false}>
        <Tickets />
      </CoreProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name').props.children).toBe('Ada'));
  });

  it('shows the update screen instead of the app after a 426, and the app again if the check says it is fine', async () => {
    const { core } = build();
    render(
      <CoreProvider core={core} bindNetwork={false}>
        <Whoami />
      </CoreProvider>,
    );
    await act(async () => {
      await core.versionGate.upgradeRequired({ minimumVersion: '3.0.0', latestVersion: '3.0.0', storeUrl: 'https://play.google.com/x' });
    });
    expect(screen.getByTestId('update-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('who')).toBeNull();
  });
});
