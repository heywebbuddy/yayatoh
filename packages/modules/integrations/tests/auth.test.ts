import { describe, expect, it } from 'vitest';
import {
  type AuthRef,
  DEMO_SEED,
  demoRemoteRecords,
  FAKE_ACCESS_TOKEN,
  fakeAuthForConnectors,
  fakeIntegrations,
  integrationAuthFromEnv,
  nangoIntegrationAuth,
  ProviderError,
  safeReturnPath,
} from '../src/index.ts';

const orgId = '01999999-0000-7000-8000-000000000001';

describe('fake IntegrationAuth (dev/CI)', () => {
  const auth = fakeAuthForConnectors();
  const connect = async (connectionId = crypto.randomUUID()) => {
    const { url } = await auth.beginConnect({
      orgId,
      connectionId,
      providerConfigKey: 'demo',
      scopes: [],
      state: 'state-1234567890abcdef',
      callbackUrl: '/o/x/integrations/callback',
    });
    expect(url).toMatch(/^\/dev\/integrations\/authorize\?/);
    expect(await auth.resolve({ orgId, connectionId, providerConfigKey: 'demo' })).toBeNull();
    const { demoFakeProvider } = await import('../src/index.ts');
    fakeIntegrations.approve({ orgId, connectionId, providerConfigKey: 'demo' }, demoFakeProvider);
    const r = await auth.resolve({ orgId, connectionId, providerConfigKey: 'demo' });
    if (!r) throw new Error('resolved');
    const ref: AuthRef = {
      orgId,
      connectionId,
      providerConfigKey: 'demo',
      authConnectionId: r.authConnectionId,
    };
    return { ref, resolved: r };
  };

  it('connects, serves the connector fake API, and never hands out the token', async () => {
    const { ref, resolved } = await connect();
    expect(resolved.accountLabel).toBe('Demo CRM (sandbox)');
    expect(JSON.stringify(resolved)).not.toContain(FAKE_ACCESS_TOKEN);
    expect(await auth.check(ref)).toBe('active');
    const res = await auth
      .client(ref)
      .request({ method: 'GET', path: '/v1/contacts', query: { since: '0' } });
    expect((res.body as { data: unknown[] }).data).toHaveLength(DEMO_SEED.length);
    expect(JSON.stringify(res)).not.toContain(FAKE_ACCESS_TOKEN);
    // A resolve is single use.
    expect(
      await auth.resolve({ orgId, connectionId: ref.connectionId, providerConfigKey: 'demo' }),
    ).toBeNull();
  });

  it('refreshes expired tokens on use and reports revocation without the provider body', async () => {
    const { ref } = await connect();
    fakeIntegrations.expireToken(ref.authConnectionId);
    await auth.client(ref).request({ method: 'GET', path: '/v1/contacts' });
    expect(fakeIntegrations.account(ref.authConnectionId)?.refreshes).toBe(1);
    fakeIntegrations.revokeAtProvider(ref.authConnectionId);
    expect(await auth.check(ref)).toBe('revoked');
    const err = await auth
      .client(ref)
      .request({ method: 'GET', path: '/v1/contacts' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).auth).toBe(true);
    // The fake provider echoed the token in its error body; the port dropped it.
    expect(`${String(err)} ${JSON.stringify(err)} ${(err as Error).stack}`).not.toContain(FAKE_ACCESS_TOKEN);
  });

  it('a ref for another org reaches nothing', async () => {
    const { ref } = await connect();
    expect(await auth.check({ ...ref, orgId: crypto.randomUUID() })).toBe('revoked');
  });

  it('forced failures surface as status codes; writes are idempotent per key', async () => {
    const { ref } = await connect();
    fakeIntegrations.failNext(ref.authConnectionId, 503);
    const err = await auth
      .client(ref)
      .request({ method: 'GET', path: '/v1/contacts' })
      .catch((e: unknown) => e as ProviderError);
    expect(err).toMatchObject({ status: 503, code: 'http_503', retryable: true });
    const send = () =>
      auth.client(ref).request({
        method: 'POST',
        path: '/v1/contacts',
        body: { fields: { email_address: 'new@x.test' }, origin: 'yayatoh:c' },
        idempotencyKey: 'k1',
      });
    const a = await send();
    const b = await send();
    expect(a.body).toEqual(b.body);
    const account = fakeIntegrations.account(ref.authConnectionId);
    if (!account) throw new Error('account');
    expect(demoRemoteRecords(account)).toHaveLength(DEMO_SEED.length + 1);
  });

  it('only relative callback paths are allowed back (no open redirect)', () => {
    expect(safeReturnPath('/o/acme/integrations/callback')).toBe(true);
    expect(safeReturnPath('//evil.test/x')).toBe(false);
    expect(safeReturnPath('https://evil.test')).toBe(false);
    expect(safeReturnPath('/\\evil')).toBe(false);
  });
});

describe('Nango adapter (no network: injected fetch)', () => {
  const ref: AuthRef = {
    orgId,
    connectionId: 'c-1',
    providerConfigKey: 'hubspot',
    authConnectionId: 'conn_1',
  };
  const SECRET = 'nango-secret-key-xyz';
  const calls: { url: string; init: RequestInit }[] = [];
  const reply =
    (status: number, body: unknown): typeof fetch =>
    async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    };

  it('creates a connect session and returns its link', async () => {
    calls.length = 0;
    const auth = nangoIntegrationAuth({
      secretKey: SECRET,
      fetch: reply(201, { data: { token: 't', connect_link: 'https://connect.nango.dev/x' } }),
    });
    const { url } = await auth.beginConnect({
      orgId,
      connectionId: 'c-1',
      providerConfigKey: 'hubspot',
      scopes: [],
      state: 's',
      callbackUrl: '/cb',
    });
    expect(url).toBe('https://connect.nango.dev/x');
    expect(calls[0]?.url).toBe('https://api.nango.dev/connect/sessions');
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      end_user: { id: 'c-1' },
      allowed_integrations: ['hubspot'],
    });
  });

  it('resolves the connection made for our id, keeping ids and labels only', async () => {
    const auth = nangoIntegrationAuth({
      secretKey: SECRET,
      fetch: reply(200, {
        connections: [
          {
            connection_id: 'conn_1',
            provider_config_key: 'hubspot',
            end_user: { display_name: 'Ada' },
            credentials: { access_token: 'leaky' },
          },
        ],
      }),
    });
    const r = await auth.resolve({ orgId, connectionId: 'c-1', providerConfigKey: 'hubspot' });
    expect(r).toEqual({ authConnectionId: 'conn_1', accountLabel: 'Ada', scopes: [] });
    expect(JSON.stringify(r)).not.toContain('leaky');
  });

  it('checks without reading credentials; 4xx means revoked', async () => {
    const ok = nangoIntegrationAuth({
      secretKey: SECRET,
      fetch: reply(200, { credentials: { access_token: 'leaky' } }),
    });
    expect(await ok.check(ref)).toBe('active');
    const gone = nangoIntegrationAuth({
      secretKey: SECRET,
      fetch: reply(400, { error: 'refresh failed leaky' }),
    });
    expect(await gone.check(ref)).toBe('revoked');
    expect(await gone.refresh(ref)).toBe('revoked');
  });

  it('proxies requests with the connection headers and drops error bodies', async () => {
    calls.length = 0;
    const auth = nangoIntegrationAuth({ secretKey: SECRET, fetch: reply(200, { ok: true }) });
    const res = await auth
      .client(ref)
      .request({ method: 'POST', path: '/crm/v3/objects', body: { a: 1 }, idempotencyKey: 'k' });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    const h = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe('https://api.nango.dev/proxy/crm/v3/objects');
    expect(h['connection-id']).toBe('conn_1');
    expect(h['provider-config-key']).toBe('hubspot');
    expect(h['nango-proxy-idempotency-key']).toBe('k');
    const failing = nangoIntegrationAuth({
      secretKey: SECRET,
      fetch: reply(401, { message: 'token Bearer leaky-token-123 invalid' }),
    });
    const err = await failing
      .client(ref)
      .request({ method: 'GET', path: '/x' })
      .catch((e: unknown) => e as ProviderError);
    expect(err).toMatchObject({ status: 401, auth: true });
    expect(`${String(err)} ${JSON.stringify(err)}`).not.toMatch(/leaky|nango-secret/);
    await expect(auth.client(ref).request({ method: 'GET', path: '//evil' })).rejects.toThrow(ProviderError);
  });

  it('revoke deletes the connection (a missing one is fine)', async () => {
    calls.length = 0;
    await nangoIntegrationAuth({ secretKey: SECRET, fetch: reply(404, '') }).revoke(ref);
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('https://api.nango.dev/connection/conn_1?provider_config_key=hubspot');
  });
});

describe('integrationAuthFromEnv', () => {
  it('fake in dev, Nango when configured, off in production otherwise', () => {
    expect(integrationAuthFromEnv({})?.provider).toBe('fake');
    expect(integrationAuthFromEnv({ NODE_ENV: 'production' })).toBeNull();
    expect(integrationAuthFromEnv({ NODE_ENV: 'production', YAYATOH_DEV_AUTH: '1' })?.provider).toBe('fake');
    expect(
      integrationAuthFromEnv({ INTEGRATIONS_AUTH_PROVIDER: 'fake', VERCEL_ENV: 'production' }),
    ).toBeNull();
    expect(
      integrationAuthFromEnv({ INTEGRATIONS_AUTH_PROVIDER: 'nango', NANGO_SECRET_KEY: 'k' })?.provider,
    ).toBe('nango');
    expect(integrationAuthFromEnv({ INTEGRATIONS_AUTH_PROVIDER: 'nango' })).toBeNull();
  });
});
