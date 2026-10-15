import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import { createPortalSession, inviteTokenFrom, prefixedStore } from '../src/portal/session';
import { createFakeDoor, json, problem } from './helpers/fake-door';
import { CHALLENGE, INVITE, inviteLink, portal, portalHandler, portalPair } from './helpers/portal-mock';

const API = 'https://app.yayatoh.com/api/v1';
const identity = { app: 'staff', platform: 'android', version: '1.2.3', build: '9' } as const;

function build(over: Parameters<typeof portal>[0] = {}, storage = memoryKeyValueStore()) {
  const clock = { now: Date.parse('2026-10-14T12:00:00Z') };
  const p = portal(over);
  const door = createFakeDoor(() => clock.now);
  const session = createPortalSession({
    storage,
    apiBaseUrl: API,
    identity,
    now: () => clock.now,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const handled = await portalHandler(p, request.clone());
      return handled ?? door.fetch(request);
    },
  });
  return { session, p, storage, clock };
}

describe('invitation links', () => {
  it('finds the token in the emailed link, or takes a pasted bare token', () => {
    expect(inviteTokenFrom(inviteLink)).toBe(INVITE);
    expect(inviteTokenFrom(`  ${inviteLink}?utm=x  `)).toBe(INVITE);
    expect(inviteTokenFrom(`https://summit.yayatoh.events/fr/event-portal/invite/${INVITE}`)).toBe(INVITE);
    expect(inviteTokenFrom(INVITE)).toBe(INVITE);
  });

  it('refuses anything else', () => {
    for (const text of [
      '',
      'hello',
      'https://app.yayatoh.com/event-portal/verify/abc',
      `x${INVITE}!`,
      'a'.repeat(39),
    ])
      expect(inviteTokenFrom(text)).toBeNull();
  });
});

describe('the portal session', () => {
  it('keeps its keys apart from the account session in the same keychain', async () => {
    const storage = memoryKeyValueStore({ 'yayatoh.session.v1': 'account-session' });
    const { session } = build({}, storage);
    await session.verifyCode(INVITE, CHALLENGE, '123456');
    expect(storage.data.get('yayatoh.session.v1')).toBe('account-session');
    expect(storage.data.get('portal.yayatoh.session.v1')).toContain('yyp_refresh1');
    await session.signOut();
    expect(storage.data.get('yayatoh.session.v1')).toBe('account-session');
    expect(storage.data.has('portal.yayatoh.session.v1')).toBe(false);
  });

  it('prefixes every key it uses', async () => {
    const base = memoryKeyValueStore();
    const store = prefixedStore(base, 'p.');
    await store.set('a', '1');
    expect(base.data.get('p.a')).toBe('1');
    expect(await store.get('a')).toBe('1');
    await store.delete('a');
    expect(base.data.size).toBe(0);
  });

  it('signs in with the emailed code and sends the bearer token on the lead routes', async () => {
    const { session, p } = build();
    expect(await session.requestCode(INVITE)).toMatchObject({ kind: 'sent', challengeId: CHALLENGE });
    expect(await session.verifyCode(INVITE, CHALLENGE, '123456')).toEqual({ kind: 'signedIn' });
    expect(session.store.state.status).toBe('signedIn');
    p.valid.add('yyp_access1');
    const { response } = await session.api.GET('/v1/portal/leads/setup');
    expect(response.status).toBe(200);
    expect(p.requests.at(-1)?.authorization).toBe('Bearer yyp_access1');
  });

  it('refreshes an ended access token once, with the rotating refresh token', async () => {
    const { session, p, clock } = build();
    await session.verifyCode(INVITE, CHALLENGE, '123456');
    p.token = (body) =>
      body.grantType === 'refresh_token' && body.refreshToken === 'yyp_refresh1'
        ? json(200, portalPair(2, clock.now))
        : problem(401, 'unauthenticated', { reason: 'refresh_token_reused' });
    p.valid.add('yyp_access2');
    clock.now += 16 * 60_000;
    const { response } = await session.api.GET('/v1/portal/leads/setup');
    expect(response.status).toBe(200);
    expect(p.requests.at(-1)?.authorization).toBe('Bearer yyp_access2');
    expect(
      p.requests.filter((r) => r.path.endsWith('/portal/auth/token') && r.body.grantType === 'refresh_token'),
    ).toHaveLength(1);
  });

  it('a refresh token the server refuses ends the session and erases it', async () => {
    const { session, p, storage, clock } = build();
    await session.verifyCode(INVITE, CHALLENGE, '123456');
    const ended: string[] = [];
    session.store.onSignedOut((reason) => void ended.push(reason));
    p.token = () => problem(401, 'unauthenticated', { reason: 'refresh_token_reused' });
    clock.now += 16 * 60_000;
    await session.api.GET('/v1/portal/leads/setup');
    expect(session.store.state).toMatchObject({ status: 'signedOut', reason: 'reused' });
    expect(ended).toEqual(['reused']);
    expect(storage.data.has('portal.yayatoh.session.v1')).toBe(false);
  });

  it('keeps the session when the network fails during a refresh', async () => {
    const { session, p, clock } = build();
    await session.verifyCode(INVITE, CHALLENGE, '123456');
    p.token = () => {
      throw new TypeError('offline');
    };
    clock.now += 16 * 60_000;
    await session.api.GET('/v1/portal/leads/setup').catch(() => undefined);
    expect(session.store.state.status).toBe('signedIn');
  });

  it('signing out revokes the refresh token on the server', async () => {
    const { session, p } = build();
    await session.verifyCode(INVITE, CHALLENGE, '123456');
    await session.signOut();
    expect(p.revoked).toEqual(['yyp_refresh1']);
    expect(session.store.state.status).toBe('signedOut');
  });

  it('comes back signed in after a restart', async () => {
    const first = build();
    await first.session.verifyCode(INVITE, CHALLENGE, '123456');
    const second = build({}, first.storage);
    expect(await second.session.store.restore()).toMatchObject({ status: 'signedIn' });
  });

  it('keeps the tokens out of every URL and request body but the sign-in and refresh calls', async () => {
    const { session, p } = build();
    await session.verifyCode(INVITE, CHALLENGE, '123456');
    p.valid.add('yyp_access1');
    await session.api.GET('/v1/portal/leads/setup');
    for (const r of p.requests) {
      expect(r.path).not.toContain('yyp_');
      expect(JSON.stringify(r.body)).not.toContain('yyp_access');
    }
  });

  it('identifies the app on its calls', async () => {
    const seen: (string | null)[] = [];
    const storage = memoryKeyValueStore();
    const session = createPortalSession({
      storage,
      apiBaseUrl: API,
      identity,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        seen.push(request.headers.get('x-yayatoh-client'));
        return json(200, { status: 'sent', challengeId: CHALLENGE, resendAt: new Date().toISOString() });
      },
    });
    await session.requestCode(INVITE);
    await session.api.GET('/v1/portal/leads/setup');
    expect(seen[0]).toBe('yayatoh-staff-android/1.2.3');
    expect(seen[1]).toBe('yayatoh-staff-android/1.2.3 (9)');
  });

  it('hears a 426 on a portal call', async () => {
    const heard: unknown[] = [];
    const session = createPortalSession({
      storage: memoryKeyValueStore(),
      apiBaseUrl: API,
      identity,
      onUpgradeRequired: (info) => void heard.push(info),
      fetch: async () => problem(426, 'upgrade_required', { minimumVersion: '9.0.0' }),
    });
    await session.api.GET('/v1/portal/leads/setup');
    expect(heard).toHaveLength(1);
  });
});
