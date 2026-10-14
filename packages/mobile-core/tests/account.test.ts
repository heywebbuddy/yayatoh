import { randomBytes } from 'node:crypto';
import { CACHE_KEY_NAME } from '../src/cache/encryption';
import { CACHE_FILE } from '../src/cache/persister';
import { createCore } from '../src/core';
import { memoryFileStore, memoryKeyValueStore } from '../src/ports';
import { SESSION_KEY } from '../src/session/session-store';
import { json, pair, problem } from './helpers/fake-api';

// Sign out everywhere and delete the account (M7.3a), over a scripted /v1.
type Handler = (req: { method: string; path: string }) => Response | Promise<Response>;

const built: { queryClient: { clear(): void } }[] = [];
// A cached query keeps a garbage-collection timer, which would keep Jest alive.
afterEach(() => {
  for (const core of built.splice(0)) core.queryClient.clear();
});

function build(handler: Handler) {
  const calls: { method: string; path: string; authorization: string | null }[] = [];
  const storage = memoryKeyValueStore();
  const files = memoryFileStore();
  const core = createCore({
    appName: 'Yayatoh',
    identity: { app: 'mobile', platform: 'ios', version: '1.0.0', build: '7' },
    apiBaseUrl: 'https://app.yayatoh.com/api/v1',
    catalogs: { en: {} },
    adapters: {
      storage,
      files,
      random: (n) => new Uint8Array(randomBytes(n)),
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname.replace(/^.*?(\/v1\/)/, '/v1/');
        calls.push({ method: request.method, path, authorization: request.headers.get('authorization') });
        if (path === '/v1/auth/revoke') return new Response(null, { status: 204 });
        return handler({ method: request.method, path });
      },
    },
  });
  built.push(core);
  return { core, calls, storage, files };
}

async function signedIn(handler: Handler) {
  const h = build(handler);
  await h.core.session.setTokens(pair(0));
  h.core.queryClient.setQueryData(['tickets'], [{ id: 1 }]);
  await h.core.persister.persistClient({
    timestamp: Date.now(),
    buster: 'b',
    clientState: { mutations: [], queries: [] },
  });
  return h;
}

const wiped = (h: Awaited<ReturnType<typeof signedIn>>) => {
  expect(h.core.session.state.status).toBe('signedOut');
  expect(h.storage.data.has(SESSION_KEY)).toBe(false);
  expect(h.storage.data.has(CACHE_KEY_NAME)).toBe(false);
  expect(h.files.files.has(CACHE_FILE)).toBe(false);
  expect(h.core.queryClient.getQueryData(['tickets'])).toBeUndefined();
};

afterEach(() => jest.restoreAllMocks());

describe('signOutEverywhere', () => {
  it('asks the server, then signs out here and wipes the tokens and the cache', async () => {
    const h = await signedIn(() => new Response(null, { status: 204 }));
    expect(await h.core.account.signOutEverywhere()).toEqual({ kind: 'done' });
    expect(h.calls[0]).toEqual({
      method: 'POST',
      path: '/v1/auth/sign-out-everywhere',
      authorization: 'Bearer access-0',
    });
    wiped(h);
  });

  it('treats a 401 as done: the server already ended this session', async () => {
    const h = await signedIn(() => problem(401, 'unauthenticated'));
    // The signed client would try to refresh on a 401; refusing that too ends the session.
    expect((await h.core.account.signOutEverywhere()).kind).toBe('done');
    wiped(h);
  });

  it('changes nothing when the server cannot be reached', async () => {
    const h = await signedIn(() => {
      throw new TypeError('Network request failed');
    });
    expect(await h.core.account.signOutEverywhere()).toEqual({ kind: 'unavailable' });
    expect(h.core.session.state.status).toBe('signedIn');
    expect(h.storage.data.has(SESSION_KEY)).toBe(true);
  });

  it('changes nothing on a server error', async () => {
    const h = await signedIn(() => problem(503, 'internal'));
    expect(await h.core.account.signOutEverywhere()).toEqual({ kind: 'unavailable' });
    expect(h.core.session.state.status).toBe('signedIn');
  });
});

describe('deleteAccount', () => {
  it('deletes, then signs out here and wipes the tokens, the cache and its key', async () => {
    const h = await signedIn(() => json(200, { requestId: 'r', summary: {} }));
    expect(await h.core.account.deleteAccount()).toEqual({ kind: 'deleted' });
    expect(h.calls[0]).toEqual({ method: 'DELETE', path: '/v1/me', authorization: 'Bearer access-0' });
    wiped(h);
  });

  it('without a fresh step-up the server refuses, and the phone keeps everything', async () => {
    const h = await signedIn(() => problem(401, 'step_up_required', { reason: 'step_up_required' }));
    expect(await h.core.account.deleteAccount()).toEqual({ kind: 'stepUpRequired' });
    expect(h.core.session.state.status).toBe('signedIn');
    expect(h.storage.data.has(SESSION_KEY)).toBe(true);
    expect(h.files.files.has(CACHE_FILE)).toBe(true);
  });

  it('names the organizations the person is the only owner of, and keeps everything', async () => {
    const h = await signedIn(() =>
      problem(409, 'invalid_state', { reason: 'last_owner', orgs: ['Alpha', 'Bravo'] }),
    );
    expect(await h.core.account.deleteAccount()).toEqual({
      kind: 'lastOwner',
      organizations: ['Alpha', 'Bravo'],
    });
    expect(h.core.session.state.status).toBe('signedIn');
  });

  it('reads the wait from a rate limit', async () => {
    const h = await signedIn(() => problem(429, 'rate_limited', { retryAfter: 90 }, { 'retry-after': '90' }));
    expect(await h.core.account.deleteAccount()).toEqual({ kind: 'rateLimited', retryAfterSeconds: 90 });
  });

  it('reports a dead network or a server error as unavailable and keeps everything', async () => {
    const offline = await signedIn(() => {
      throw new TypeError('Network request failed');
    });
    expect(await offline.core.account.deleteAccount()).toEqual({ kind: 'unavailable' });
    expect(offline.core.session.state.status).toBe('signedIn');
    const broken = await signedIn(() => problem(500, 'internal'));
    expect(await broken.core.account.deleteAccount()).toEqual({ kind: 'unavailable' });
    expect(broken.core.session.state.status).toBe('signedIn');
  });

  it('any other refusal is a plain failure that keeps everything', async () => {
    const h = await signedIn(() => problem(403, 'forbidden'));
    expect(await h.core.account.deleteAccount()).toEqual({ kind: 'failed' });
    expect(h.core.session.state.status).toBe('signedIn');
  });
});
