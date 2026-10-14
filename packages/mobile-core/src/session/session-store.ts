/**
 * The signed-in session (M7.1c, ADR 0010): an access token (15 minutes) and a rotating refresh token
 * (30 days) in secure storage, with three guarantees.
 *
 * - **One refresh at a time.** Every caller that needs a new token waits for the same request. A
 *   request that got a 401 while another one refreshed does not refresh again: the refresh token is
 *   single use, so a second refresh would present a spent one and sign the person out.
 * - **A dead refresh token ends the session.** If the server says the refresh token was reused,
 *   revoked, expired or unknown (a 401), the app signs out and wipes everything local: the keys, the
 *   cached server state and whatever else registered with `onSignedOut`. A network error or a 5xx
 *   changes nothing: the person stays signed in and the next request tries again.
 * - **Tokens stay here.** They leave secure storage only inside an `Authorization` header.
 */
import type { Schemas, YayatohClient } from '@yayatoh/sdk';
import type { KeyValueStore } from '../ports';
import { readProblem } from '../problem';

export type TokenPair = Schemas['TokenPair'];
export type SessionUser = Schemas['User'];

export const SESSION_KEY = 'yayatoh.session.v1';
/** A token that ends within this long is refreshed before a request rather than after its 401. */
export const REFRESH_SKEW_MS = 30_000;

interface StoredSession {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
  readonly user: SessionUser;
}

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signedOut'; readonly reason: SignOutReason | null }
  | { readonly status: 'signedIn'; readonly user: SessionUser };

/** Why the session ended, for the screen that explains it (never shown with a token in it). */
export type SignOutReason = 'signed_out' | 'refresh_rejected' | 'reused';

export type RefreshOutcome =
  | { readonly ok: true; readonly tokens: TokenPair }
  /** The server answered 401: this refresh token is finished. `reason` is `details.reason`. */
  | { readonly ok: false; readonly kind: 'rejected'; readonly reason: string | null }
  /** Offline, a timeout, a 429 or a 5xx: nothing is known about the token. */
  | { readonly ok: false; readonly kind: 'unavailable' };

/** The two token calls the store makes, over a client that carries no token of its own. */
export interface TokenEndpoint {
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  revoke(refreshToken: string): Promise<void>;
}

export interface SessionStoreOptions {
  readonly storage: KeyValueStore;
  readonly endpoint: TokenEndpoint;
  readonly now?: () => number;
  /** Where a failure is reported. Never pass a token or a person's details. */
  readonly log?: (message: string) => void;
}

export interface SessionStore {
  readonly state: SessionState;
  subscribe(listener: () => void): () => void;
  /** Loads the stored session once; resolves when `state` is `signedIn` or `signedOut`. */
  restore(): Promise<SessionState>;
  /** A usable access token, refreshed first when it is about to end. */
  accessToken(): Promise<string | undefined>;
  /** The server refused `sentToken`: true when a different usable token now exists. */
  refreshAfterUnauthorized(sentToken: string): Promise<boolean>;
  /** Stores the tokens of a completed sign-in. */
  setTokens(tokens: TokenPair): Promise<void>;
  /** Ends the session here and on the server, then wipes. */
  signOut(): Promise<void>;
  /** Runs when the session ends for any reason, after the tokens are gone. Returns its remover. */
  onSignedOut(callback: (reason: SignOutReason) => void | Promise<void>): () => void;
}

function parse(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof v.accessToken === 'string' && typeof v.refreshToken === 'string' && v.user)
      return v as StoredSession;
  } catch {
    // Unreadable means signed out.
  }
  return null;
}

export function createSessionStore(opts: SessionStoreOptions): SessionStore {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const listeners = new Set<() => void>();
  const wipeCallbacks = new Set<(reason: SignOutReason) => void | Promise<void>>();
  let current: StoredSession | null = null;
  let state: SessionState = { status: 'loading' };
  let loaded: Promise<SessionState> | null = null;
  let inflight: Promise<boolean> | null = null;

  const setState = (next: SessionState) => {
    state = next;
    for (const l of listeners) l();
  };

  const persist = async (s: StoredSession) => {
    // Memory first: a refresh token that was just spent must never be used again, even when the
    // keychain write fails.
    current = s;
    try {
      await opts.storage.set(SESSION_KEY, JSON.stringify(s));
    } catch {
      log('session: could not write secure storage');
    }
  };

  const toStored = (t: TokenPair): StoredSession => ({
    accessToken: t.accessToken,
    accessTokenExpiresAt: t.accessTokenExpiresAt,
    refreshToken: t.refreshToken,
    refreshTokenExpiresAt: t.refreshTokenExpiresAt,
    user: t.user,
  });

  /** Tokens gone first (nothing can use them), then every registered wipe, then listeners. */
  const end = async (reason: SignOutReason) => {
    current = null;
    try {
      await opts.storage.delete(SESSION_KEY);
    } catch {
      log('session: could not clear secure storage');
    }
    await Promise.all(
      [...wipeCallbacks].map(async (cb) => {
        try {
          await cb(reason);
        } catch {
          log('session: a wipe callback failed');
        }
      }),
    );
    setState({ status: 'signedOut', reason });
  };

  const load = (): Promise<SessionState> => {
    loaded ??= (async () => {
      let stored: StoredSession | null = null;
      try {
        stored = parse(await opts.storage.get(SESSION_KEY));
      } catch {
        log('session: could not read secure storage');
      }
      if (stored && Date.parse(stored.refreshTokenExpiresAt) > now()) {
        current = stored;
        setState({ status: 'signedIn', user: stored.user });
      } else {
        if (stored) await end('refresh_rejected');
        else setState({ status: 'signedOut', reason: null });
      }
      return state;
    })();
    return loaded;
  };

  const doRefresh = async (): Promise<boolean> => {
    const from = current;
    if (!from) return false;
    const outcome = await opts.endpoint.refresh(from.refreshToken);
    // The person signed out (or in again) while the request was away: its answer is for a session
    // that no longer exists and must not bring it back.
    if (current !== from) return false;
    if (outcome.ok) {
      await persist(toStored(outcome.tokens));
      setState({ status: 'signedIn', user: outcome.tokens.user });
      return true;
    }
    if (outcome.kind === 'rejected') {
      await end(outcome.reason === 'refresh_token_reused' ? 'reused' : 'refresh_rejected');
    }
    return false;
  };

  /** Everyone who needs a new token awaits this one request. */
  const refresh = (): Promise<boolean> => {
    inflight ??= doRefresh().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore: load,
    async accessToken() {
      await load();
      if (!current) return undefined;
      if (Date.parse(current.accessTokenExpiresAt) - now() < REFRESH_SKEW_MS) await refresh();
      return current?.accessToken;
    },
    async refreshAfterUnauthorized(sentToken) {
      await load();
      if (!current) return false;
      // Someone else already replaced the token this request used: just repeat it.
      if (current.accessToken !== sentToken) return true;
      return refresh();
    },
    async setTokens(tokens) {
      await load();
      await persist(toStored(tokens));
      setState({ status: 'signedIn', user: tokens.user });
    },
    async signOut() {
      await load();
      const token = current?.refreshToken;
      // Tell the server first (best effort): offline sign-out still clears this phone.
      if (token) await opts.endpoint.revoke(token).catch(() => log('session: revoke failed'));
      await end('signed_out');
    },
    onSignedOut(callback) {
      wipeCallbacks.add(callback);
      return () => wipeCallbacks.delete(callback);
    },
  };
}

/** Adapts the `/v1/auth/token` and `/v1/auth/revoke` calls to the store's `TokenEndpoint`. */
export function tokenEndpoint(api: YayatohClient): TokenEndpoint {
  return {
    async refresh(refreshToken) {
      try {
        const { data, error, response } = await api.POST('/v1/auth/token', {
          body: { grantType: 'refresh_token', refreshToken },
        });
        if (response.ok && data) return { ok: true, tokens: data };
        if (response.status === 401) {
          const reason = readProblem(error, 401).reason;
          return { ok: false, kind: 'rejected', reason };
        }
      } catch {
        // Offline or a timeout: nothing is known about the token.
      }
      return { ok: false, kind: 'unavailable' };
    },
    async revoke(refreshToken) {
      await api.POST('/v1/auth/revoke', { body: { refreshToken } });
    },
  };
}
