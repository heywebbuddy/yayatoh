import { clientHeader, clientName, createApiClient, sdkBaseUrl, type UpgradeInfo } from '../src/client';
import { createFakeApi, json, problem } from './helpers/fake-api';

describe('X-Yayatoh-Client', () => {
  it.each([
    [{ app: 'mobile', platform: 'ios', version: '1.4.2', build: '45' }, 'yayatoh-ios/1.4.2 (45)'],
    [{ app: 'mobile', platform: 'android', version: '1.4.2', build: '45' }, 'yayatoh-android/1.4.2 (45)'],
    [{ app: 'staff', platform: 'ios', version: '2.0.0', build: '7' }, 'yayatoh-staff-ios/2.0.0 (7)'],
    [{ app: 'staff', platform: 'android', version: '2.0.0' }, 'yayatoh-staff-android/2.0.0'],
  ] as const)('%j -> %s', (identity, header) => {
    expect(clientHeader(identity)).toBe(header);
  });

  it('leaves out a build number that is not a plain number or version', () => {
    expect(clientHeader({ app: 'mobile', platform: 'ios', version: '1.0.0', build: '4 5)(' })).toBe(
      'yayatoh-ios/1.0.0',
    );
  });

  it('names exactly the four identifiers the server knows', () => {
    expect(
      [clientName('mobile', 'ios'), clientName('mobile', 'android'), clientName('staff', 'ios'), clientName('staff', 'android')],
    ).toEqual(['yayatoh-ios', 'yayatoh-android', 'yayatoh-staff-ios', 'yayatoh-staff-android']);
  });
});

describe('sdkBaseUrl', () => {
  it('drops the /v1 the SDK paths already carry', () => {
    expect(sdkBaseUrl('https://app.yayatoh.com/api/v1')).toBe('https://app.yayatoh.com/api');
    expect(sdkBaseUrl('https://app.yayatoh.com/api/v1/')).toBe('https://app.yayatoh.com/api');
    expect(sdkBaseUrl('http://localhost:3000/api/v1')).toBe('http://localhost:3000/api');
    expect(sdkBaseUrl('https://api.yayatoh.com')).toBe('https://api.yayatoh.com');
  });
});

describe('createApiClient', () => {
  const identity = { app: 'mobile', platform: 'ios', version: '1.2.3', build: '9' } as const;

  it('calls /v1 under the configured base, with the client header and the bearer token', async () => {
    const fake = createFakeApi();
    const api = createApiClient({
      baseUrl: 'https://app.yayatoh.com/api/v1',
      identity,
      tokens: { accessToken: async () => 'access-0' },
      fetch: fake.fetch,
    });
    const { data, response } = await api.GET('/v1/me');
    expect(response.status).toBe(200);
    expect(data?.email).toBe('ada@example.test');
    expect(fake.calls[0]).toMatchObject({
      fullPath: '/api/v1/me',
      authorization: 'Bearer access-0',
      client: 'yayatoh-ios/1.2.3 (9)',
    });
  });

  it('sends no Authorization header without a token', async () => {
    const fake = createFakeApi();
    const api = createApiClient({ baseUrl: 'https://x.test/api/v1', identity, fetch: fake.fetch });
    await api.GET('/v1/me');
    expect(fake.calls[0]?.authorization).toBeNull();
  });

  it('reports a 426 with the store link, and still returns the response', async () => {
    const seen: UpgradeInfo[] = [];
    const api = createApiClient({
      baseUrl: 'https://x.test/api/v1',
      identity,
      onUpgradeRequired: (i) => seen.push(i),
      fetch: async () =>
        problem(426, 'upgrade_required', {
          minimumVersion: '2.0.0',
          latestVersion: '2.1.0',
          storeUrl: 'https://apps.apple.com/app/yayatoh/id1',
        }),
    });
    const { response } = await api.GET('/v1/me');
    expect(response.status).toBe(426);
    expect(seen).toEqual([
      { minimumVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: 'https://apps.apple.com/app/yayatoh/id1' },
    ]);
  });

  it('does not refresh for a 401 that is a step-up request, and repeats a 401 once at most', async () => {
    const refresh = jest.fn(async () => true);
    const fake = createFakeApi();
    const api = createApiClient({
      baseUrl: 'https://x.test/api/v1',
      identity,
      tokens: { accessToken: async () => 'access-0', refreshAfterUnauthorized: refresh },
      fetch: fake.fetch,
    });
    await api.POST('/v1/auth/step-up', { body: { method: 'totp', code: '123456' } });
    expect(refresh).not.toHaveBeenCalled();

    // A token the server never accepts: one refresh, one repeat, then the 401 is the answer.
    const stubborn = jest.fn(async (_: Request) => problem(401, 'unauthenticated'));
    const api2 = createApiClient({
      baseUrl: 'https://x.test/api/v1',
      identity,
      tokens: { accessToken: async () => 'nope', refreshAfterUnauthorized: refresh },
      fetch: stubborn as unknown as typeof fetch,
    });
    const { response } = await api2.GET('/v1/me');
    expect(response.status).toBe(401);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(stubborn).toHaveBeenCalledTimes(2);
  });

  it('keeps JSON bodies intact across the repeat', async () => {
    let attempt = 0;
    const bodies: string[] = [];
    const api = createApiClient({
      baseUrl: 'https://x.test/api/v1',
      identity,
      tokens: { accessToken: async () => `t${attempt}`, refreshAfterUnauthorized: async () => ((attempt += 1), true) },
      fetch: (async (req: Request) => {
        bodies.push(await req.text());
        return attempt === 0 ? problem(401, 'unauthenticated') : json(204 === 0 ? 0 : 200, {});
      }) as unknown as typeof fetch,
    });
    await api.POST('/v1/auth/step-up', { body: { method: 'password', password: 'r' } });
    expect(bodies).toEqual(['{"method":"password","password":"r"}', '{"method":"password","password":"r"}']);
  });
});
