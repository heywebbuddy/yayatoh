/**
 * The core of both apps (M7.1c): one object that owns the session, the `/v1` clients, the query
 * cache, the sign-in helpers and the version gate, wired together so each rule holds everywhere:
 *
 * - a 426 from any call reaches the version gate;
 * - a session that ends (sign-out, a reused or revoked refresh token) clears the cached server state;
 * - the cache key lives in secure storage, the cache itself in an encrypted file.
 *
 * `createCore` is plain TypeScript with every native dependency injectable, so it is tested without
 * a phone; the apps call it once, with `nativeAdapters()`, from `CoreProvider`.
 */
import type { QueryClient } from '@tanstack/react-query';
import { createYayatohClient, type YayatohClient } from '@yayatoh/sdk';
import { createCacheKeyProvider } from './cache/encryption';
import { createEncryptedPersister, type EncryptedPersister } from './cache/persister';
import { clearServerState, createAppQueryClient } from './cache/query-client';
import { type ClientIdentity, clientName, createApiClient, sdkBaseUrl } from './client';
import type { MessageTree } from './i18n/catalogs';
import type { AppLocale } from './i18n/locales';
import { initSentry } from './platform/sentry';
import type { FileStore, KeyValueStore, RandomBytes } from './ports';
import { type Account, createAccount } from './session/account';
import type { AppleSignInProvider, GoogleSignInProvider } from './session/providers';
import { createSessionStore, type SessionStore, tokenEndpoint } from './session/session-store';
import { createSignIn, type SignIn } from './session/sign-in';
import { createVersionGate, type VersionGate } from './version/gate';

export interface CoreAdapters {
  readonly storage: KeyValueStore;
  readonly files: FileStore;
  readonly random: RandomBytes;
  readonly apple?: AppleSignInProvider;
  readonly google?: GoogleSignInProvider;
  readonly fetch?: typeof globalThis.fetch;
}

export interface CoreOptions {
  /** The display name in messages: `Yayatoh` or `Yayatoh Staff`. */
  readonly appName: string;
  readonly identity: ClientIdentity;
  /** The configured API URL (`…/api/v1`). */
  readonly apiBaseUrl: string;
  /** The app's own catalogs; the shared strings are added to each. */
  readonly catalogs: Partial<Record<AppLocale, MessageTree>>;
  readonly adapters: CoreAdapters;
  readonly environment?: string;
  readonly sentryDsn?: string;
  /** True while a Staff device is inside its event window: the version gate then only nudges. */
  readonly suppressRequiredUpdate?: () => boolean | Promise<boolean>;
}

export interface Core {
  readonly appName: string;
  readonly identity: ClientIdentity;
  readonly catalogs: CoreOptions['catalogs'];
  readonly storage: KeyValueStore;
  readonly session: SessionStore;
  /** Signed `/v1` client: refreshes once on a 401 and reports a 426. */
  readonly api: YayatohClient;
  /** Unsigned client for the calls made before there is a session. */
  readonly publicApi: YayatohClient;
  readonly signIn: SignIn;
  /** Sign out everywhere and delete the account (M7.3a). */
  readonly account: Account;
  readonly queryClient: QueryClient;
  readonly persister: EncryptedPersister;
  readonly versionGate: VersionGate;
  /** The release string sent with crash reports. */
  readonly release: string;
}

export function createCore(options: CoreOptions): Core {
  const { adapters, identity } = options;
  const client = clientName(identity.app, identity.platform);
  const release = `${client}@${identity.version}${identity.build ? `+${identity.build}` : ''}`;
  initSentry({ dsn: options.sentryDsn, environment: options.environment ?? 'production', release });

  let gate!: VersionGate;
  const onUpgradeRequired = (info: Parameters<VersionGate['upgradeRequired']>[0]) =>
    void gate.upgradeRequired(info);

  const publicApi = createApiClient({
    baseUrl: options.apiBaseUrl,
    identity,
    onUpgradeRequired,
    ...(adapters.fetch ? { fetch: adapters.fetch } : {}),
  });
  // The token calls need a client that never tries to refresh itself.
  const tokenApi = createYayatohClient({
    baseUrl: sdkBaseUrl(options.apiBaseUrl),
    client: `${client}/${identity.version}`,
    ...(adapters.fetch ? { fetch: adapters.fetch } : {}),
  });
  const session = createSessionStore({ storage: adapters.storage, endpoint: tokenEndpoint(tokenApi) });
  const api = createApiClient({
    baseUrl: options.apiBaseUrl,
    identity,
    tokens: session,
    onUpgradeRequired,
    ...(adapters.fetch ? { fetch: adapters.fetch } : {}),
  });

  const queryClient = createAppQueryClient();
  const persister = createEncryptedPersister({
    files: adapters.files,
    keys: createCacheKeyProvider(adapters.storage, adapters.random),
    random: adapters.random,
  });
  // The person's data goes when their session does, however it ended.
  session.onSignedOut(() => clearServerState(queryClient, persister));

  gate = createVersionGate({
    api: publicApi,
    client,
    appVersion: identity.version,
    ...(options.suppressRequiredUpdate ? { suppressRequired: options.suppressRequiredUpdate } : {}),
  });

  return {
    appName: options.appName,
    identity,
    catalogs: options.catalogs,
    storage: adapters.storage,
    session,
    api,
    publicApi,
    signIn: createSignIn({
      publicApi,
      api,
      session,
      random: adapters.random,
      ...(adapters.apple ? { apple: adapters.apple } : {}),
      ...(adapters.google ? { google: adapters.google } : {}),
    }),
    account: createAccount({ api, session }),
    queryClient,
    persister,
    versionGate: gate,
    release,
  };
}
