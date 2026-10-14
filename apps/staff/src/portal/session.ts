/**
 * The exhibitor rep's portal session (M7.4a, decision P7-6): the invitation emailed to a rep, a
 * six-digit code emailed on request, then a bearer session (`yyp_…`, 15 minutes) with a rotating
 * refresh token in secure storage. The lead screens (M7.4c) call `/v1/portal/leads/*` with `api`.
 *
 * It reuses mobile-core's session store for what is subtle there (one refresh at a time, a spent or
 * revoked refresh token ends the session and wipes) over its own namespace in secure storage, so a
 * rep's session and an organizer's account session never touch each other. The tokens leave secure
 * storage only inside an `Authorization` header.
 */
import {
  type ApiClientOptions,
  type ClientIdentity,
  createApiClient,
  createSessionStore,
  type KeyValueStore,
  type SessionStore,
  type UpgradeInfo,
} from '@yayatoh/mobile-core';
import { createYayatohClient, type YayatohClient } from '@yayatoh/sdk';
import { readProblem } from './problem';

export const PORTAL_PREFIX = 'portal.';

/** The invitation token in an emailed link (`…/event-portal/invite/<token>`), or a pasted bare token. */
const INVITE_TOKEN = /^[A-Za-z0-9_-]{40,300}$/;
const INVITE_LINK = /\/event-portal\/invite\/([A-Za-z0-9_-]{40,300})(?:[/?#]|$)/;

export function inviteTokenFrom(input: string): string | null {
  const text = input.trim();
  if (INVITE_TOKEN.test(text)) return text;
  return INVITE_LINK.exec(text)?.[1] ?? null;
}

/** Prefixes every key, so two sessions can share one keychain without sharing a key. */
export function prefixedStore(store: KeyValueStore, prefix: string): KeyValueStore {
  return {
    get: (key) => store.get(`${prefix}${key}`),
    set: (key, value) => store.set(`${prefix}${key}`, value),
    delete: (key) => store.delete(`${prefix}${key}`),
  };
}

export type CodeRequestOutcome =
  | { readonly kind: 'sent'; readonly challengeId: string; readonly resendAt: string }
  /** A code was sent less than 30 seconds ago: use that one. */
  | { readonly kind: 'cooldown'; readonly challengeId: string; readonly resendAt: string }
  /** Forged, reissued, revoked or expired invitation. */
  | { readonly kind: 'invalid_invite' }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'unavailable' };

export type VerifyOutcome =
  | { readonly kind: 'signedIn' }
  | { readonly kind: 'wrong_code'; readonly attemptsLeft: number | null }
  /** Five wrong tries, an expired or an already used code: ask for a new one. */
  | { readonly kind: 'code_rejected' }
  | { readonly kind: 'invalid_invite' }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'unavailable' };

export interface PortalSessionOptions {
  readonly storage: KeyValueStore;
  readonly apiBaseUrl: string;
  readonly identity: ClientIdentity;
  readonly fetch?: typeof globalThis.fetch;
  readonly onUpgradeRequired?: (info: UpgradeInfo) => void;
  readonly log?: (message: string) => void;
  readonly now?: () => number;
}

const retryAfter = (response: Response, details: Record<string, unknown>): number | null => {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header;
  const detail = Number(details.retryAfter);
  return Number.isFinite(detail) && detail > 0 ? detail : null;
};

interface PortalPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly refreshExpiresAt: string;
}

/** The store keeps a person with every session; a rep has no account, so this is a placeholder. */
const REP = { id: 'portal', email: '', name: '', emailVerified: true } as const;
const toTokenPair = (p: PortalPair) => ({
  accessToken: p.accessToken,
  tokenType: 'bearer' as const,
  accessTokenExpiresAt: p.expiresAt,
  refreshToken: p.refreshToken,
  refreshTokenExpiresAt: p.refreshExpiresAt,
  user: REP,
});

export interface PortalSession {
  readonly store: SessionStore;
  /** The `/v1` client signed with the rep's bearer token (refreshes once on a 401). */
  readonly api: YayatohClient;
  requestCode(inviteToken: string): Promise<CodeRequestOutcome>;
  verifyCode(inviteToken: string, challengeId: string, code: string): Promise<VerifyOutcome>;
  signOut(): Promise<void>;
}

export function createPortalSession(options: PortalSessionOptions): PortalSession {
  const storage = prefixedStore(options.storage, PORTAL_PREFIX);
  const base = options.apiBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const raw = createYayatohClient({
    baseUrl: base,
    client: `yayatoh-staff-${options.identity.platform}/${options.identity.version}`,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const store = createSessionStore({
    storage,
    ...(options.now ? { now: options.now } : {}),
    ...(options.log ? { log: options.log } : {}),
    endpoint: {
      async refresh(refreshToken) {
        try {
          const { data, error, response } = await raw.POST('/v1/portal/auth/token', {
            body: { grantType: 'refresh_token', refreshToken },
          });
          if (response.ok && data) return { ok: true, tokens: toTokenPair(data) };
          if (response.status === 401)
            return { ok: false, kind: 'rejected', reason: readProblem(error, 401).reason };
        } catch {
          // Offline or a timeout: nothing is known about the token.
        }
        return { ok: false, kind: 'unavailable' };
      },
      async revoke(refreshToken) {
        await raw.POST('/v1/portal/auth/revoke', { body: { refreshToken } });
      },
    },
  });

  const clientOptions: ApiClientOptions = {
    baseUrl: options.apiBaseUrl,
    identity: options.identity,
    tokens: store,
    ...(options.onUpgradeRequired ? { onUpgradeRequired: options.onUpgradeRequired } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };

  return {
    store,
    api: createApiClient(clientOptions),

    async requestCode(inviteToken) {
      const result = await raw.POST('/v1/portal/auth/code', { body: { inviteToken } }).catch(() => null);
      if (!result) return { kind: 'unavailable' };
      const { data, error, response } = result;
      if (response.ok && data)
        return { kind: data.status, challengeId: data.challengeId, resendAt: data.resendAt };
      const p = readProblem(error, response.status);
      if (response.status === 429 || p.code === 'rate_limited')
        return { kind: 'rateLimited', retryAfterSeconds: retryAfter(response, p.details) };
      if (response.status === 403 || response.status === 400) return { kind: 'invalid_invite' };
      return { kind: 'unavailable' };
    },

    async verifyCode(inviteToken, challengeId, code) {
      const result = await raw
        .POST('/v1/portal/auth/token', { body: { grantType: 'code', inviteToken, challengeId, code } })
        .catch(() => null);
      if (!result) return { kind: 'unavailable' };
      const { data, error, response } = result;
      if (response.ok && data && 'refreshToken' in data) {
        await store.setTokens(toTokenPair(data));
        return { kind: 'signedIn' };
      }
      const p = readProblem(error, response.status);
      if (response.status === 429 || p.code === 'rate_limited')
        return { kind: 'rateLimited', retryAfterSeconds: retryAfter(response, p.details) };
      if (response.status === 403) return { kind: 'invalid_invite' };
      if (response.status === 401) {
        if (p.reason === 'wrong_code') {
          const left = Number(p.details.attemptsLeft);
          return { kind: 'wrong_code', attemptsLeft: Number.isFinite(left) ? left : null };
        }
        return { kind: 'code_rejected' };
      }
      return response.status >= 500 || response.status === 0
        ? { kind: 'unavailable' }
        : { kind: 'code_rejected' };
    },

    signOut: () => store.signOut(),
  };
}
