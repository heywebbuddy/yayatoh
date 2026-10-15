import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import { createYayatohClient } from '@yayatoh/sdk';
import { createPushRegistrar, REGISTRATION_KEY, REREGISTER_AFTER_MS } from '../src/push/registration';
import { DEVICE, fakePort, fakeServer } from './helpers/push-harness';

function setup(over: { permission?: 'granted' | 'denied' | 'undetermined'; userId?: string | null } = {}) {
  const server = fakeServer();
  const port = fakePort({ permission: over.permission ?? 'granted' });
  const storage = memoryKeyValueStore();
  let clock = 1_000_000;
  let locale = 'pt';
  let userId: string | null = over.userId === undefined ? 'user-1' : over.userId;
  const registrar = createPushRegistrar({
    port,
    api: createYayatohClient({ baseUrl: 'https://app.yayatoh.com/api', fetch: server.fetch, token: 'tok' }),
    storage,
    device: DEVICE,
    locale: () => locale,
    userId: () => userId,
    timeZone: () => 'Europe/Lisbon',
    now: () => clock,
  });
  return {
    server,
    port,
    storage,
    registrar,
    advance(ms: number) {
      clock += ms;
    },
    setLocale(l: string) {
      locale = l;
    },
    setUser(u: string | null) {
      userId = u;
    },
  };
}
const posts = (s: ReturnType<typeof setup>) => s.server.calls.filter((c) => c.method === 'POST');

describe('registering the phone', () => {
  it('sends the token with the app id, version, language and time zone (FCM)', async () => {
    const s = setup();
    expect(await s.registrar.sync()).toBe('registered');
    expect(s.server.calls).toHaveLength(1);
    expect(s.server.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/me/devices',
      authorization: 'Bearer tok',
      body: {
        platform: 'fcm',
        token: 'fcm-token-aaaaaaaaaaaaaaaa',
        appId: 'com.yayatoh.yayatohapp',
        appVersion: '1.2.3',
        locale: 'pt',
        timeZone: 'Europe/Lisbon',
      },
    });
    // The APNs environment belongs to APNs tokens only.
    expect(s.server.calls[0]?.body).not.toHaveProperty('environment');
  });

  it('an APNs token also says which environment issued it', async () => {
    const s = setup();
    s.port.token = { platform: 'apns', token: 'ab'.repeat(32) };
    await s.registrar.sync();
    expect(s.server.calls[0]?.body).toMatchObject({ platform: 'apns', environment: 'production' });
  });

  it.each([
    ['the phone has not been asked', 'undetermined'],
    ['the person said no', 'denied'],
  ] as const)('does nothing while %s: no token is requested, nothing is sent', async (_why, permission) => {
    const s = setup({ permission });
    expect(await s.registrar.sync()).toBe('skipped');
    expect(s.server.calls).toHaveLength(0);
  });

  it('does nothing when signed out', async () => {
    const s = setup({ userId: null });
    expect(await s.registrar.sync()).toBe('skipped');
    expect(s.server.calls).toHaveLength(0);
  });

  it('does nothing when the phone cannot give a token (simulator, no Google services)', async () => {
    const s = setup();
    s.port.token = null;
    expect(await s.registrar.sync()).toBe('skipped');
    expect(s.server.calls).toHaveLength(0);
  });

  it('does not repeat an unchanged registration, until a week has passed', async () => {
    const s = setup();
    await s.registrar.sync();
    expect(await s.registrar.sync()).toBe('unchanged');
    s.advance(REREGISTER_AFTER_MS - 1);
    expect(await s.registrar.sync()).toBe('unchanged');
    s.advance(2);
    expect(await s.registrar.sync()).toBe('registered');
    expect(posts(s)).toHaveLength(2);
  });

  it('refreshes when the token, the language or the person changes', async () => {
    const s = setup();
    await s.registrar.sync();
    s.port.token = { platform: 'fcm', token: 'fcm-token-bbbbbbbbbbbbbbbb' };
    expect(await s.registrar.sync()).toBe('registered');
    s.setLocale('ar');
    expect(await s.registrar.sync()).toBe('registered');
    s.setUser('user-2');
    expect(await s.registrar.sync()).toBe('registered');
    expect(posts(s).map((c) => (c.body as { token: string; locale: string }).locale)).toEqual([
      'pt',
      'pt',
      'ar',
      'ar',
    ]);
  });

  it('registers again when the OS rotates the token', async () => {
    const s = setup();
    await s.registrar.sync();
    const stop = s.registrar.watchToken();
    s.port.token = { platform: 'fcm', token: 'rotated-token-cccccccccccc' };
    s.port.emitToken(s.port.token);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(posts(s)).toHaveLength(2);
    expect(posts(s).map((c) => (c.body as { token: string }).token)).toEqual([
      'fcm-token-aaaaaaaaaaaaaaaa',
      'rotated-token-cccccccccccc',
    ]);
    stop();
    s.port.emitToken({ platform: 'fcm', token: 'ignored-token-dddddddddddd' });
    await new Promise((r) => setTimeout(r, 0));
    expect(posts(s)).toHaveLength(2);
  });

  it('keeps asking until the server has stored the phone somewhere (organizations: 0), and after a purchase', async () => {
    const s = setup();
    s.server.organizations = 0; // no order or ticket yet
    expect(await s.registrar.sync()).toBe('registered');
    expect(await s.registrar.sync()).toBe('registered'); // not "unchanged": nothing is stored yet
    s.server.organizations = 1; // after the first purchase
    expect(await s.registrar.sync({ force: true })).toBe('registered');
    expect(await s.registrar.sync()).toBe('unchanged');
    expect(await s.registrar.sync({ force: true })).toBe('registered');
    expect(posts(s)).toHaveLength(4);
  });

  it('a failed registration is reported, remembers nothing, and is tried again next time', async () => {
    const s = setup();
    s.server.failDevices = true;
    expect(await s.registrar.sync()).toBe('failed');
    expect(s.storage.data.has(REGISTRATION_KEY)).toBe(false);
    s.server.failDevices = false;
    expect(await s.registrar.sync()).toBe('registered');

    const offline = setup();
    offline.server.offline = true;
    expect(await offline.registrar.sync()).toBe('failed');
  });

  it('two calls at once make one request; a forced one waits its turn and still runs', async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.registrar.sync(), s.registrar.sync()]);
    expect([a, b]).toEqual(['registered', 'registered']);
    expect(posts(s)).toHaveLength(1);
    const [c, d] = await Promise.all([s.registrar.sync(), s.registrar.sync({ force: true })]);
    expect([c, d]).toEqual(['unchanged', 'registered']);
    expect(posts(s)).toHaveLength(2);
  });

  it('never writes the token anywhere but secure storage', async () => {
    const s = setup();
    await s.registrar.sync();
    expect(s.storage.data.get(REGISTRATION_KEY)).toContain('fcm-token-aaaaaaaaaaaaaaaa');
  });
});

describe('removing the registration', () => {
  it('deletes the phone on the server (token URL-encoded) and forgets it here', async () => {
    const s = setup();
    s.port.token = { platform: 'fcm', token: 'a/b:c d-eeeeeeeeeeeeeeeeeee' };
    await s.registrar.sync();
    await s.registrar.unregister();
    const del = s.server.calls.find((c) => c.method === 'DELETE');
    expect(del?.path).toBe('/v1/me/devices/a%2Fb%3Ac%20d-eeeeeeeeeeeeeeeeeee');
    expect(del?.authorization).toBe('Bearer tok');
    expect(s.storage.data.has(REGISTRATION_KEY)).toBe(false);
  });

  it('with nothing registered, there is nothing to delete', async () => {
    const s = setup();
    await s.registrar.unregister();
    expect(s.server.calls).toHaveLength(0);
  });

  it('offline: forgets it here and does not throw (sign-out still works)', async () => {
    const s = setup();
    await s.registrar.sync();
    s.server.offline = true;
    await expect(s.registrar.unregister()).resolves.toBeUndefined();
    expect(s.storage.data.has(REGISTRATION_KEY)).toBe(false);
  });
});
