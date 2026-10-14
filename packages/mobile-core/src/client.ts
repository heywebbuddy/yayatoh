/**
 * The `/v1` client for the apps (M7.1c): `@yayatoh/sdk` with the base URL from config, a token
 * callback, `X-Yayatoh-Client` (`yayatoh-ios/<version> (<build>)`), one refresh on a 401 and a hook
 * for the 426 that sends the app to the update screen. Apps never `fetch` a `/v1` path by hand.
 */
import { createYayatohClient, type YayatohClient } from '@yayatoh/sdk';
import { readProblem } from './problem';

export type MobileApp = 'mobile' | 'staff';
export type MobilePlatform = 'ios' | 'android';
/** The identifiers `KNOWN_CLIENTS` and the version gate know (packages/api-v1/src/telemetry.ts). */
export type ClientName = 'yayatoh-ios' | 'yayatoh-android' | 'yayatoh-staff-ios' | 'yayatoh-staff-android';

export interface ClientIdentity {
  readonly app: MobileApp;
  readonly platform: MobilePlatform;
  /** `1.4.2`: the marketing version, which the server compares with the minimum. */
  readonly version: string;
  /** The store build number, shown to support only. */
  readonly build?: string;
}

export const clientName = (app: MobileApp, platform: MobilePlatform): ClientName =>
  `${app === 'staff' ? 'yayatoh-staff' : 'yayatoh'}-${platform}`;

/** `yayatoh-ios/1.4.2 (45)`; the server reads the name and the first word of the rest. */
export function clientHeader(id: ClientIdentity): string {
  const build = id.build && /^[0-9A-Za-z.]{1,20}$/.test(id.build) ? ` (${id.build})` : '';
  return `${clientName(id.app, id.platform)}/${id.version}${build}`;
}

/**
 * The SDK's paths already start with `/v1`, while the apps' configured API URL ends with it
 * (`https://app.yayatoh.com/api/v1`). Strip one trailing `/v1` so the two do not double up.
 */
export function sdkBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** What a `426` says: where to get the update and which versions matter. */
export interface UpgradeInfo {
  readonly minimumVersion: string | null;
  readonly latestVersion: string | null;
  readonly storeUrl: string | null;
}

/** The part of the session the client needs: a token to send and a way to recover from a 401. */
export interface TokenSource {
  accessToken(): Promise<string | undefined>;
  /**
   * The server refused `sentToken`. Resolve true when a different, usable token now exists, so the
   * request can be repeated once. Omit it for tokens that cannot be refreshed (a door device's).
   */
  refreshAfterUnauthorized?(sentToken: string): Promise<boolean>;
}

export interface ApiClientOptions {
  /** The configured API URL, with or without `/v1`. */
  readonly baseUrl: string;
  readonly identity: ClientIdentity;
  readonly tokens?: TokenSource;
  readonly onUpgradeRequired?: (info: UpgradeInfo) => void;
  readonly fetch?: typeof globalThis.fetch;
}

const bearerOf = (request: Request): string | undefined =>
  /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];

/** The first path segment after the base is `v1/auth/…` for the routes that never need a refresh. */
const isTokenEndpoint = (url: string) => /\/v1\/auth\/(?:token|email-code|revoke)(?:[/?#]|$)/.test(url);

async function problemOf(response: Response) {
  try {
    return readProblem(await response.clone().json(), response.status);
  } catch {
    return readProblem(null, response.status);
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** The `fetch` the SDK uses: sends the request, refreshes once on a 401, reports a 426. */
export function authenticatedFetch(opts: ApiClientOptions): typeof globalThis.fetch {
  const base = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const checkUpgrade = async (response: Response) => {
    if (response.status !== 426) return;
    const p = await problemOf(response);
    opts.onUpgradeRequired?.({
      minimumVersion: str(p.details.minimumVersion),
      latestVersion: str(p.details.latestVersion),
      storeUrl: str(p.details.storeUrl),
    });
  };
  return async (input, init) => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const spare = request.clone();
    const sentToken = bearerOf(request);
    let response = await base(request);
    await checkUpgrade(response);
    // A 401 `unauthenticated` is a token the server will not take. A `step_up_required` or any other
    // 401 is an answer, not a stale token, and must reach the caller unchanged.
    if (
      response.status === 401 &&
      sentToken &&
      opts.tokens?.refreshAfterUnauthorized &&
      !isTokenEndpoint(request.url) &&
      (await problemOf(response)).code === 'unauthenticated' &&
      (await opts.tokens.refreshAfterUnauthorized(sentToken))
    ) {
      const fresh = await opts.tokens.accessToken();
      if (fresh) {
        spare.headers.set('authorization', `Bearer ${fresh}`);
        response = await base(spare);
        await checkUpgrade(response);
      }
    }
    return response;
  };
}

/** A typed `/v1` client that signs requests with the session and identifies the app. */
export function createApiClient(opts: ApiClientOptions): YayatohClient {
  const tokens = opts.tokens;
  return createYayatohClient({
    baseUrl: sdkBaseUrl(opts.baseUrl),
    client: clientHeader(opts.identity),
    ...(tokens ? { token: () => tokens.accessToken() } : {}),
    fetch: authenticatedFetch(opts),
  });
}
