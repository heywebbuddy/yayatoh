import { createYayatohClient } from '@yayatoh/sdk';
import { createApiClient } from '../src/client';
import { memoryKeyValueStore } from '../src/ports';
import {
  BEFORE_SIGN_OUT_TIMEOUT_MS,
  createSessionStore,
  SESSION_KEY,
  type SessionStore,
  tokenEndpoint,
} from '../src/session/session-store';
import { createFakeApi, pair, problem } from './helpers/fake-api';

const identity = { app: 'mobile', platform: 'ios', version: '1.0.0', build: '1' } as const;
const BASE = 'https://app.yayatoh.com/api/v1';

function setup(opts: { now?: () => number; storedPair?: ReturnType<typeof pair> | null } = {}) {
  const now = opts.now ?? Date.now;
  const fake = createFakeApi(now);
  const storage = memoryKeyValueStore();
  const bare = createYayatohClient({ baseUrl: 'https://app.yayatoh.com/api', fetch: fake.fetch });
  const session = createSessionStore({ storage, endpoint: tokenEndpoint(bare), now });
  const api = createApiClient({ baseUrl: BASE, identity, tokens: session, fetch: fake.fetch });
  return { fake, storage, session, api, now };
}

async function signedIn(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts);
  await s.session.setTokens(pair(0, s.now()));
  return s;
}

describe('session store', () => {
  it('stores the tokens in secure storage and restores them in a new process', async () => {
    const { session, storage, now } = await signedIn();
    expect(session.state).toMatchObject({ status: 'signedIn', user: { name: 'Ada' } });
    expect(storage.data.has(SESSION_KEY)).toBe(true);

    const again = createSessionStore({
      storage,
      endpoint: { refresh: async () => ({ ok: false, kind: 'unavailable' }), revoke: async () => {} },
      now,
    });
    expect(again.state.status).toBe('loading');
    expect(await again.restore()).toMatchObject({ status: 'signedIn' });
    expect(await again.accessToken()).toBe('access-0');
  });

  it('is signed out with no stored session or an unreadable one', async () => {
    const empty = createSessionStore({
      storage: memoryKeyValueStore(),
      endpoint: { refresh: async () => ({ ok: false, kind: 'unavailable' }), revoke: async () => {} },
    });
    expect(await empty.restore()).toEqual({ status: 'signedOut', reason: null });

    const junk = createSessionStore({
      storage: memoryKeyValueStore({ [SESSION_KEY]: '{not json' }),
      endpoint: { refresh: async () => ({ ok: false, kind: 'unavailable' }), revoke: async () => {} },
    });
    expect((await junk.restore()).status).toBe('signedOut');
  });

  it('wipes a stored session whose refresh token has expired', async () => {
    const { storage, now } = await signedIn();
    const wiped = jest.fn();
    const later = createSessionStore({
      storage,
      endpoint: { refresh: async () => ({ ok: false, kind: 'unavailable' }), revoke: async () => {} },
      now: () => now() + 31 * 86_400_000,
    });
    later.onSignedOut(wiped);
    expect(await later.restore()).toEqual({ status: 'signedOut', reason: 'refresh_rejected' });
    expect(wiped).toHaveBeenCalledWith('refresh_rejected');
    expect(storage.data.has(SESSION_KEY)).toBe(false);
  });

  it('two simultaneous 401s cause exactly one refresh, and both requests succeed', async () => {
    const { fake, api, session } = await signedIn();
    fake.valid.clear(); // The server stopped accepting access-0 (it ended or was revoked).
    fake.valid.add('something-else');
    fake.delayRefreshMs = 20; // Both 401s land while the refresh is still running.

    const [a, b] = await Promise.all([api.GET('/v1/me'), api.GET('/v1/me')]);

    expect(a.response.status).toBe(200);
    expect(b.response.status).toBe(200);
    expect(fake.refreshes()).toBe(1);
    expect(fake.calls.filter((c) => c.path === '/v1/me').map((c) => c.authorization)).toEqual([
      'Bearer access-0',
      'Bearer access-0',
      'Bearer access-1',
      'Bearer access-1',
    ]);
    expect(await session.accessToken()).toBe('access-1');
  });

  it('a request that 401s after another already refreshed repeats without refreshing again', async () => {
    const { fake, session } = await signedIn();
    fake.valid.clear();
    expect(await session.refreshAfterUnauthorized('access-0')).toBe(true);
    expect(fake.refreshes()).toBe(1);
    // A late 401 for the old token: the store already has a newer one.
    expect(await session.refreshAfterUnauthorized('access-0')).toBe(true);
    expect(fake.refreshes()).toBe(1);
  });

  it('rotates the refresh token: each refresh sends the latest one', async () => {
    const { fake, session } = await signedIn();
    expect(await session.refreshAfterUnauthorized('access-0')).toBe(true);
    expect(await session.refreshAfterUnauthorized('access-1')).toBe(true);
    const sent = fake.calls
      .filter((c) => c.path === '/v1/auth/token')
      .map((c) => (c.body as { refreshToken: string }).refreshToken);
    expect(sent).toEqual(['refresh-0', 'refresh-1']);
  });

  it('refreshes before a request when the access token is about to end', async () => {
    let t = Date.now();
    const { fake, session } = await signedIn({ now: () => t });
    t += 15 * 60_000 - 10_000; // 10 s left, under the 30 s skew
    expect(await session.accessToken()).toBe('access-1');
    expect(fake.refreshes()).toBe(1);
  });

  it('a reused refresh token signs out and wipes local data', async () => {
    const { fake, session, storage, api } = await signedIn();
    const wipe = jest.fn(async () => {});
    session.onSignedOut(wipe);
    fake.expectedRefresh = 'refresh-someone-else'; // Another copy of the app spent this token.
    fake.valid.clear();

    const { response } = await api.GET('/v1/me');

    expect(response.status).toBe(401);
    expect(session.state).toEqual({ status: 'signedOut', reason: 'reused' });
    expect(wipe).toHaveBeenCalledWith('reused');
    expect(storage.data.size).toBe(0);
    expect(await session.accessToken()).toBeUndefined();
  });

  it('a revoked family signs out the same way', async () => {
    const { fake, session, api } = await signedIn();
    fake.failRefreshWith = () => problem(401, 'unauthenticated', { reason: 'refresh_token_revoked' });
    fake.valid.clear();
    await api.GET('/v1/me');
    expect(session.state).toEqual({ status: 'signedOut', reason: 'refresh_rejected' });
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Network request failed'))],
    ['a 503', () => problem(503, 'internal')],
    ['a 429', () => problem(429, 'rate_limited')],
  ])('%s during refresh keeps the person signed in', async (_name, fail) => {
    const { fake, session, storage, api } = await signedIn();
    const wipe = jest.fn();
    session.onSignedOut(wipe);
    fake.failRefreshWith = fail as never;
    fake.valid.clear();

    const { response } = await api.GET('/v1/me');

    expect(response.status).toBe(401);
    expect(session.state.status).toBe('signedIn');
    expect(wipe).not.toHaveBeenCalled();
    expect(storage.data.has(SESSION_KEY)).toBe(true);
    // The next attempt works once the network is back.
    fake.failRefreshWith = undefined;
    expect((await api.GET('/v1/me')).response.status).toBe(200);
  });

  it('sign out revokes the refresh token, wipes, and still wipes when the revoke fails', async () => {
    const { fake, session, storage } = await signedIn();
    const wipe = jest.fn();
    session.onSignedOut(wipe);
    await session.signOut();
    expect(
      fake.calls.some(
        (c) =>
          c.path === '/v1/auth/revoke' && (c.body as { refreshToken: string }).refreshToken === 'refresh-0',
      ),
    ).toBe(true);
    expect(wipe).toHaveBeenCalledWith('signed_out');
    expect(session.state).toEqual({ status: 'signedOut', reason: 'signed_out' });
    expect(storage.data.size).toBe(0);

    const offline = await signedIn();
    offline.fake.fetch = (async () => {
      throw new TypeError('offline');
    }) as never;
    const s = createSessionStore({
      storage: offline.storage,
      endpoint: {
        refresh: async () => ({ ok: false, kind: 'unavailable' }),
        revoke: async () => {
          throw new Error('offline');
        },
      },
    });
    await s.restore();
    await s.signOut();
    expect(s.state.status).toBe('signedOut');
    expect(offline.storage.data.size).toBe(0);
  });

  it('keeps going when a wipe callback throws', async () => {
    const { session } = await signedIn();
    const second = jest.fn();
    session.onSignedOut(() => {
      throw new Error('boom');
    });
    session.onSignedOut(second);
    await session.signOut();
    expect(second).toHaveBeenCalled();
    expect(session.state.status).toBe('signedOut');
  });

  it('runs before-sign-out callbacks while the tokens still work, and never lets one stop the sign-out', async () => {
    const { fake, session } = await signedIn();
    const order: string[] = [];
    session.beforeSignOut(async () => {
      // The tokens still work here, so a signed request can be made.
      order.push((await session.accessToken()) ? 'before' : 'broken');
    });
    session.beforeSignOut(() => {
      throw new Error('boom');
    });
    session.onSignedOut(() => void order.push('wiped'));
    const removed = jest.fn();
    session.beforeSignOut(removed)();
    await session.signOut();
    expect(order).toEqual(['before', 'wiped']);
    expect(removed).not.toHaveBeenCalled();
    expect(fake.calls.some((c) => c.path === '/v1/auth/revoke')).toBe(true);
    expect(session.state).toEqual({ status: 'signedOut', reason: 'signed_out' });
  });

  it('abandons a before-sign-out callback that hangs (offline), then signs out', async () => {
    jest.useFakeTimers();
    try {
      const { session } = await signedIn();
      session.beforeSignOut(() => new Promise<void>(() => {}));
      const done = session.signOut();
      await jest.advanceTimersByTimeAsync(BEFORE_SIGN_OUT_TIMEOUT_MS + 10);
      await done;
      expect(session.state).toEqual({ status: 'signedOut', reason: 'signed_out' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not run before-sign-out callbacks when the server ended the session', async () => {
    const { fake, session } = await signedIn();
    const before = jest.fn();
    session.beforeSignOut(before);
    fake.valid.clear();
    fake.expectedRefresh = 'other';
    await session.refreshAfterUnauthorized('access-0');
    expect(session.state.status).toBe('signedOut');
    expect(before).not.toHaveBeenCalled();
  });

  it('a refresh that finishes after sign-out does not bring the session back', async () => {
    const { fake, session, storage } = await signedIn();
    fake.delayRefreshMs = 30;
    fake.valid.clear();
    const refreshing = session.refreshAfterUnauthorized('access-0');
    await new Promise((r) => setTimeout(r, 5));
    await session.signOut();
    expect(await refreshing).toBe(false);
    expect(session.state).toMatchObject({ status: 'signedOut', reason: 'signed_out' });
    expect(storage.data.size).toBe(0);
    expect(await session.accessToken()).toBeUndefined();
  });

  it('notifies subscribers of every state change', async () => {
    const { session } = setup();
    await session.restore();
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.state.status));
    await session.setTokens(pair(0));
    await session.signOut();
    expect(seen).toEqual(['signedIn', 'signedOut']);
  });
});

export type { SessionStore };
