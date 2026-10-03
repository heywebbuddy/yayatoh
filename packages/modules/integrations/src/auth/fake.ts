import type {
  AuthRef,
  AuthStatus,
  IntegrationAuth,
  ProviderClient,
  ProviderRequest,
  ProviderResponse,
  ResolvedConnection,
} from './port.ts';
import { ProviderError } from './port.ts';

/**
 * The fake `IntegrationAuth` (dev, CI, previews): a consent screen on our own origin
 * (`/dev/integrations/authorize`), provider-side connections held in memory, and each connector's
 * own fake API (`ConnectorDefinition.fake`). No network.
 *
 * Its tokens are leak canaries: every access and refresh token is `FAKE_ACCESS_TOKEN` /
 * `FAKE_REFRESH_TOKEN` (`__CANARY_integrations.oauth.*__`), which the canary matcher treats as a
 * secret. They are attached to requests inside this file only, and a fake provider that refuses
 * a call echoes the token in its error body (as real providers do) — the port drops error bodies,
 * so the canary must never show up in a log, an error, the inbox, an audit row or a page.
 */

export const FAKE_ACCESS_TOKEN = '__CANARY_integrations.oauth.access_token__';
export const FAKE_REFRESH_TOKEN = '__CANARY_integrations.oauth.refresh_token__';

/** Tokens the fake issues live this long (fake clock: the request's `now`). */
const TOKEN_TTL_MS = 60 * 60_000;

/** One provider-side account behind a fake connection. */
export interface FakeAccount {
  readonly authConnectionId: string;
  readonly orgId: string;
  readonly connectionId: string;
  readonly providerConfigKey: string;
  revoked: boolean;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  refreshes: number;
  /** The fake provider's data for this account (the connector's fake owns its shape). */
  data: unknown;
  /** Statuses the next requests answer with (one each), to rehearse provider failures. */
  failNext: number[];
  /** Every request the provider received (method, path, idempotency key): never the token. */
  readonly log: { method: string; path: string; idempotencyKey: string | null }[];
}

/** A connector's fake API: seeds an account's data and answers requests against it. */
export interface FakeProvider {
  readonly accountLabel: string;
  seed(): unknown;
  /** Answer one authorized request. `token` is the bearer the request carried. */
  handle(account: FakeAccount, req: ProviderRequest, token: string): ProviderResponse;
}

interface FakeState {
  /** Our connection id → the account approved on the consent screen (until resolved). */
  readonly approvals: Map<string, string>;
  readonly accounts: Map<string, FakeAccount>;
}

const KEY = Symbol.for('yayatoh.integrations.fake');

/** Shared across bundles of one process (route handlers, Server Actions, the dev drain). */
function state(): FakeState {
  const g = globalThis as unknown as Record<symbol, FakeState | undefined>;
  g[KEY] ??= { approvals: new Map(), accounts: new Map() };
  return g[KEY];
}

/** What the fake consent screen asks for. */
export interface FakeConsent {
  readonly connectionId: string;
  readonly orgId: string;
  readonly providerConfigKey: string;
  readonly state: string;
  readonly returnTo: string;
}

/** Only our own relative callback path may be a return target (no open redirect). */
export const safeReturnPath = (p: string) => /^\/(?!\/)[A-Za-z0-9/_\-.~%?=&]*$/.test(p) && !p.includes('\\');

/**
 * Dev controls for the fake (the consent screen, the dev route and tests): approve a consent,
 * revoke at the provider, look at or change an account's data, make the next requests fail.
 */
export const fakeIntegrations = {
  /** The consent screen's Allow: creates the provider-side account. */
  approve(c: { orgId: string; connectionId: string; providerConfigKey: string }, provider: FakeProvider) {
    const s = state();
    const authConnectionId = `fake_${crypto.randomUUID()}`;
    s.accounts.set(authConnectionId, {
      authConnectionId,
      orgId: c.orgId,
      connectionId: c.connectionId,
      providerConfigKey: c.providerConfigKey,
      revoked: false,
      accessToken: FAKE_ACCESS_TOKEN,
      refreshToken: FAKE_REFRESH_TOKEN,
      tokenExpiresAt: Date.now() + TOKEN_TTL_MS,
      refreshes: 0,
      data: provider.seed(),
      failNext: [],
      log: [],
    });
    s.approvals.set(c.connectionId, authConnectionId);
    return authConnectionId;
  },
  /** The organizer revoked our access in the provider's own settings. */
  revokeAtProvider(authConnectionId: string): boolean {
    const a = state().accounts.get(authConnectionId);
    if (!a) return false;
    a.revoked = true;
    return true;
  },
  account(authConnectionId: string): FakeAccount | null {
    return state().accounts.get(authConnectionId) ?? null;
  },
  /** The account behind one of our connections (dev route: by our connection id). */
  accountFor(connectionId: string): FakeAccount | null {
    for (const a of state().accounts.values()) if (a.connectionId === connectionId) return a;
    return null;
  },
  /** Make the account's tokens look expired (the next call refreshes them). */
  expireToken(authConnectionId: string) {
    const a = state().accounts.get(authConnectionId);
    if (a) a.tokenExpiresAt = 0;
  },
  failNext(authConnectionId: string, ...statuses: number[]) {
    state()
      .accounts.get(authConnectionId)
      ?.failNext.push(...statuses);
  },
};

/** The fake port. `providers` maps provider config keys to the connectors' fake APIs. */
export function fakeIntegrationAuth(providers: (key: string) => FakeProvider | null): IntegrationAuth {
  const live = (ref: AuthRef): FakeAccount | null => {
    const a = state().accounts.get(ref.authConnectionId);
    if (!a || a.orgId !== ref.orgId || a.providerConfigKey !== ref.providerConfigKey) return null;
    return a;
  };
  const refreshed = (a: FakeAccount): AuthStatus => {
    if (a.revoked) return 'revoked';
    if (a.tokenExpiresAt <= Date.now()) {
      a.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
      a.refreshes += 1;
    }
    return 'active';
  };
  return {
    provider: 'fake',
    async beginConnect(input) {
      const q = new URLSearchParams({
        org: input.orgId,
        connection: input.connectionId,
        provider: input.providerConfigKey,
        state: input.state,
        return: input.callbackUrl,
      });
      return { url: `/dev/integrations/authorize?${q.toString()}` };
    },
    async resolve(input): Promise<ResolvedConnection | null> {
      const s = state();
      const id = s.approvals.get(input.connectionId);
      const a = id ? s.accounts.get(id) : undefined;
      if (!a || a.orgId !== input.orgId || a.providerConfigKey !== input.providerConfigKey) return null;
      s.approvals.delete(input.connectionId);
      return {
        authConnectionId: a.authConnectionId,
        accountLabel: providers(a.providerConfigKey)?.accountLabel ?? null,
        scopes: [],
      };
    },
    async check(ref) {
      const a = live(ref);
      return a ? refreshed(a) : 'revoked';
    },
    async refresh(ref) {
      const a = live(ref);
      if (!a || a.revoked) return 'revoked';
      a.tokenExpiresAt = 0;
      return refreshed(a);
    },
    async revoke(ref) {
      const a = live(ref);
      if (a) a.revoked = true;
    },
    client(ref): ProviderClient {
      return {
        async request(req) {
          const a = live(ref);
          const provider = providers(ref.providerConfigKey);
          if (!a || !provider) throw new ProviderError(401, 'unknown_connection');
          a.log.push({ method: req.method, path: req.path, idempotencyKey: req.idempotencyKey ?? null });
          // The port attaches the credential; a revoked account's provider refuses it and echoes the
          // token back in its error body, which never leaves this function.
          const status = refreshed(a);
          const forced = a.failNext.shift();
          const res: ProviderResponse =
            status === 'revoked'
              ? {
                  status: 401,
                  body: { error: 'invalid_token', detail: `token ${a.accessToken} was revoked` },
                }
              : forced
                ? {
                    status: forced,
                    body: { error: 'forced', detail: `request with ${a.accessToken} failed` },
                  }
                : provider.handle(a, req, a.accessToken);
          if (res.status < 200 || res.status > 299)
            throw new ProviderError(res.status, res.status === 401 ? 'invalid_token' : undefined);
          return res;
        },
      };
    },
  };
}
