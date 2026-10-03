/**
 * The `IntegrationAuth` port (M6.4a, decision P6-4): OAuth connect, token refresh and revoke for
 * third-party connectors. Production uses Nango (Cloud), which holds the tokens; dev and CI use the
 * fake. **Tokens never leave the port**: Yayatoh stores only the provider's connection id and
 * metadata, connectors call the provider through `client(ref).request(...)` (the port attaches
 * the credentials), and a failed call surfaces as a status code, never the provider's error body
 * (providers echo tokens in errors).
 */

/** Which connection a call is for. None of these is a secret. */
export interface AuthRef {
  readonly orgId: string;
  /** Our connection row's id. */
  readonly connectionId: string;
  /** The provider integration (Nango's "provider config key"). */
  readonly providerConfigKey: string;
  /** The provider-side connection id (Nango's connection id). */
  readonly authConnectionId: string;
}

export interface ProviderRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path on the provider's API, starting with `/`. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /** Sent as `Idempotency-Key` so a retried write is applied once by providers that support it. */
  readonly idempotencyKey?: string;
  /**
   * Extra provider headers that name no credential (M6.5d: Xero's `Xero-tenant-id`). Names are
   * checked by `providerHeaderName`; the port attaches the credentials itself.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'host',
  'connection-id',
  'provider-config-key',
  'idempotency-key',
  'content-type',
  'content-length',
]);

/** Whether a connector may send this header to its provider (never a credential or a routing header). */
export const providerHeaderName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(name) &&
  !FORBIDDEN_HEADERS.has(name.toLowerCase()) &&
  !/^(nango|x-forwarded|sec-)/i.test(name);

export interface ProviderResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Calls the provider as the connection. Throws `ProviderError` for any non-2xx answer. */
export interface ProviderClient {
  request(req: ProviderRequest): Promise<ProviderResponse>;
}

export interface BeginConnect {
  readonly orgId: string;
  readonly connectionId: string;
  readonly providerConfigKey: string;
  readonly scopes: readonly string[];
  /** Opaque, single-use; comes back on the callback. */
  readonly state: string;
  /** Where the provider's consent screen returns the browser (our callback). */
  readonly callbackUrl: string;
}

/** What a finished connect yields: ids and labels only. */
export interface ResolvedConnection {
  readonly authConnectionId: string;
  /** The account's name at the provider, for the console ("Ada's workspace"). */
  readonly accountLabel: string | null;
  readonly scopes: readonly string[];
}

export type AuthStatus = 'active' | 'revoked';

export interface IntegrationAuth {
  readonly provider: 'nango' | 'fake';
  /** Start OAuth: the URL to send the organizer to (the provider's consent screen). */
  beginConnect(input: BeginConnect): Promise<{ readonly url: string }>;
  /** After consent: the provider-side connection for our connection id, or null if none yet. */
  resolve(input: {
    readonly orgId: string;
    readonly connectionId: string;
    readonly providerConfigKey: string;
  }): Promise<ResolvedConnection | null>;
  /** Whether the connection still works (refreshing its token if it expired). */
  check(ref: AuthRef): Promise<AuthStatus>;
  /** Force a token refresh. `revoked` when the provider refuses it. */
  refresh(ref: AuthRef): Promise<AuthStatus>;
  /** Revoke at the provider and forget the tokens. Idempotent. */
  revoke(ref: AuthRef): Promise<void>;
  client(ref: AuthRef): ProviderClient;
}

/**
 * A provider call that failed: the HTTP status and a short code, never the response body.
 * 401/403 mean the connection no longer works (`auth`); 429 and 5xx are worth retrying.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code?: string) {
    const c = code ?? (status === 401 || status === 403 ? 'auth_failed' : `http_${status}`);
    super(`Provider answered ${status} (${c})`);
    this.name = 'ProviderError';
    this.status = status;
    this.code = c;
  }
  get auth(): boolean {
    return this.status === 401 || this.status === 403;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

export const isProviderError = (e: unknown): e is ProviderError => e instanceof ProviderError;

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [redacted]'],
  [
    /\b(access_token|refresh_token|id_token|client_secret|api_key|apikey|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"'&,}]{4,}/gi,
    '$1$2[redacted]',
  ],
  [/\bya29\.[A-Za-z0-9._-]+/g, '[redacted]'],
  [/\bxox[abprs]-[A-Za-z0-9-]+/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[redacted]'],
];

/**
 * Defence in depth for anything an integration stores or logs (errors inbox messages, run
 * errors): strips bearer/basic credentials, `token=`-style pairs, JWTs and well-known token
 * shapes, and caps the length. Callers store codes; this guards the rare free-text message.
 */
export function redactSecrets(text: string, max = 300): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
