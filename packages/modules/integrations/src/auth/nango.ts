import type { AuthRef, AuthStatus, IntegrationAuth, ProviderClient, ResolvedConnection } from './port.ts';
import { ProviderError, providerHeaderName } from './port.ts';

/**
 * The Nango (Cloud) adapter for `IntegrationAuth` (decision P6-4). Nango runs the OAuth dance,
 * stores and refreshes the tokens; we call providers through Nango's proxy, which attaches the
 * credential, so no token ever reaches Yayatoh. Endpoints (UNVERIFIED until the owner's Nango
 * account exists, owner inbox):
 * - `POST /connect/sessions`: a connect session for one end user (our connection id) → `connect_link`;
 * - `GET /connection?endUserId=`: the connection made for it;
 * - `GET /connection/{id}?provider_config_key=`: a live check (Nango refreshes expired tokens; the
 *   response carries credentials, which this adapter never reads);
 * - `DELETE /connection/{id}?provider_config_key=`: revoke;
 * - `{METHOD} /proxy{path}` with `Connection-Id` and `Provider-Config-Key` headers.
 * Error bodies are never read: a failure is its status code.
 */
export interface NangoOptions {
  /** `NANGO_SECRET_KEY` (environment secret; never logged). */
  readonly secretKey: string;
  /** `NANGO_HOST`, default `https://api.nango.dev`. */
  readonly baseUrl?: string;
  /** Injected for tests (no network in CI). */
  readonly fetch?: typeof fetch;
}

const ID = /^[A-Za-z0-9._:-]{1,255}$/;

export function nangoIntegrationAuth(o: NangoOptions): IntegrationAuth {
  const base = (o.baseUrl ?? 'https://api.nango.dev').replace(/\/+$/, '');
  const doFetch = o.fetch ?? fetch;
  const call = async (
    method: string,
    path: string,
    init: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; json: unknown }> => {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          authorization: `Bearer ${o.secretKey}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
      });
    } catch {
      throw new ProviderError(0, 'network');
    }
    if (!res.ok) {
      // Drain without reading: provider and Nango errors may quote credentials.
      await res.body?.cancel().catch(() => undefined);
      throw new ProviderError(res.status, res.status === 401 ? 'invalid_token' : undefined);
    }
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
  };
  const ref = (r: AuthRef) => {
    if (!ID.test(r.authConnectionId) || !ID.test(r.providerConfigKey))
      throw new ProviderError(400, 'bad_reference');
    return {
      path: `/connection/${encodeURIComponent(r.authConnectionId)}`,
      query: { provider_config_key: r.providerConfigKey },
    };
  };
  const status = async (r: AuthRef, forceRefresh: boolean): Promise<AuthStatus> => {
    const { path, query } = ref(r);
    try {
      // The body holds the credentials: we only learn that the connection answered.
      await call('GET', path, { query: forceRefresh ? { ...query, force_refresh: 'true' } : query });
      return 'active';
    } catch (err) {
      if (err instanceof ProviderError && [400, 401, 403, 404, 424].includes(err.status)) return 'revoked';
      throw err;
    }
  };
  return {
    provider: 'nango',
    async beginConnect(input) {
      const { json } = await call('POST', '/connect/sessions', {
        body: {
          end_user: { id: input.connectionId },
          organization: { id: input.orgId },
          allowed_integrations: [input.providerConfigKey],
        },
      });
      const link = (json as { data?: { connect_link?: unknown } } | null)?.data?.connect_link;
      if (typeof link !== 'string' || !/^https:\/\//.test(link))
        throw new ProviderError(502, 'no_connect_link');
      return { url: link };
    },
    async resolve(input): Promise<ResolvedConnection | null> {
      const { json } = await call('GET', '/connection', { query: { endUserId: input.connectionId } });
      const list = ((json as { connections?: unknown[] } | null)?.connections ?? []) as {
        connection_id?: unknown;
        provider_config_key?: unknown;
        provider?: unknown;
        end_user?: { display_name?: unknown; email?: unknown } | null;
      }[];
      const c = list.find(
        (x) => x.provider_config_key === input.providerConfigKey && typeof x.connection_id === 'string',
      );
      if (!c || typeof c.connection_id !== 'string' || !ID.test(c.connection_id)) return null;
      const label = c.end_user?.display_name;
      return {
        authConnectionId: c.connection_id,
        accountLabel: typeof label === 'string' ? label.slice(0, 120) : null,
        scopes: [],
      };
    },
    check: (r) => status(r, false),
    refresh: (r) => status(r, true),
    async revoke(r) {
      const { path, query } = ref(r);
      try {
        await call('DELETE', path, { query });
      } catch (err) {
        if (!(err instanceof ProviderError && err.status === 404)) throw err;
      }
    },
    client(r): ProviderClient {
      ref(r);
      return {
        async request(req) {
          if (!req.path.startsWith('/') || req.path.startsWith('//'))
            throw new ProviderError(400, 'bad_path');
          const extra = Object.entries(req.headers ?? {});
          if (extra.some(([k, v]) => !providerHeaderName(k) || /[\r\n]/.test(v)))
            throw new ProviderError(400, 'bad_header');
          const { status, json } = await call(req.method, `/proxy${req.path}`, {
            ...(req.query ? { query: { ...req.query } } : {}),
            ...(req.body !== undefined ? { body: req.body } : {}),
            headers: {
              'connection-id': r.authConnectionId,
              'provider-config-key': r.providerConfigKey,
              // Nango forwards `Nango-Proxy-*` headers to the provider without the prefix.
              ...(req.idempotencyKey ? { 'nango-proxy-idempotency-key': req.idempotencyKey } : {}),
              ...Object.fromEntries(extra.map(([k, v]) => [`nango-proxy-${k.toLowerCase()}`, v])),
            },
          });
          return { status, body: json };
        },
      };
    },
  };
}
