import { createYayatohClient } from '@yayatoh/sdk';
import { memoryKeyValueStore } from '../src/ports';
import { hashNonce, makeNonce } from '../src/session/providers';
import { createSessionStore, tokenEndpoint } from '../src/session/session-store';
import { createSignIn } from '../src/session/sign-in';
import { json, pair, problem } from './helpers/fake-api';

type Handler = (path: string, body: Record<string, unknown>) => Response | Promise<Response>;

function setup(handler: Handler, extra: Partial<Parameters<typeof createSignIn>[0]> = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: Request) => {
    const raw = await input.clone().text();
    const body = raw ? JSON.parse(raw) : {};
    const path = new URL(input.url).pathname.replace(/^.*?(\/v1\/)/, '/v1/');
    calls.push({ path, body });
    return handler(path, body);
  }) as unknown as typeof fetch;
  const api = createYayatohClient({ baseUrl: 'https://x.test/api', fetch: fetchImpl });
  const storage = memoryKeyValueStore();
  const session = createSessionStore({ storage, endpoint: tokenEndpoint(api) });
  let counter = 0;
  const random = (n: number) => new Uint8Array(n).fill(++counter);
  const signIn = createSignIn({ publicApi: api, api, session, random, ...extra });
  return { signIn, session, calls, storage };
}

const ok: Handler = () => json(200, pair(0));

describe('email code', () => {
  it('requests a code and reports how long it works', async () => {
    const { signIn, calls } = setup(() => json(202, { expiresInSeconds: 600 }));
    expect(await signIn.requestEmailCode('  ada@example.test ')).toEqual({ kind: 'sent', expiresInSeconds: 600 });
    expect(calls[0]).toEqual({ path: '/v1/auth/email-code', body: { email: 'ada@example.test' } });
  });

  it('reports a rate limit with the wait, and a dead network as unavailable', async () => {
    const limited = setup(() => problem(429, 'rate_limited', { retryAfter: 90 }));
    expect(await limited.signIn.requestEmailCode('a@b.test')).toEqual({ kind: 'rateLimited', retryAfterSeconds: 90 });
    const offline = setup(() => Promise.reject(new TypeError('offline')));
    expect(await offline.signIn.requestEmailCode('a@b.test')).toEqual({ kind: 'unavailable' });
  });

  it('signs in with the code and stores the session', async () => {
    const { signIn, session, calls } = setup(ok);
    const out = await signIn.withEmailCode(' ada@example.test', ' 123456 ');
    expect(out).toMatchObject({ kind: 'signedIn', user: { name: 'Ada' } });
    expect(calls[0]?.body).toEqual({ grantType: 'email_code', email: 'ada@example.test', code: '123456' });
    expect(session.state).toMatchObject({ status: 'signedIn' });
    expect(await session.accessToken()).toBe('access-0');
  });

  it.each([
    ['invalid_code'],
    ['too_many_attempts'],
  ] as const)('a refused code (%s) is a failure with the server reason, and signs nobody in', async (reason) => {
    const { signIn, session } = setup(() => problem(401, 'unauthenticated', { reason }));
    expect(await signIn.withEmailCode('a@b.test', '000000')).toEqual({ kind: 'failed', reason });
    expect(session.state.status).not.toBe('signedIn');
  });

  it('maps an unknown reason to unknown and a 5xx to unavailable', async () => {
    expect(await setup(() => problem(401, 'unauthenticated', { reason: 'novel' })).signIn.withEmailCode('a@b.test', '1')).toEqual({ kind: 'failed', reason: 'unknown' });
    expect(await setup(() => problem(503, 'internal')).signIn.withEmailCode('a@b.test', '1')).toEqual({ kind: 'unavailable' });
  });
});

describe('password and the two-factor step', () => {
  it('a two-factor account gets a challenge, not tokens, then tokens after the code', async () => {
    const handler: Handler = (_p, body) =>
      body.grantType === 'password'
        ? problem(401, 'step_up_required', {
            reason: 'two_factor_required',
            challenge: 'chal-1',
            challengeExpiresAt: '2026-10-14T10:05:00Z',
          })
        : body.grantType === 'two_factor' && body.challenge === 'chal-1' && body.code === '654321'
          ? json(200, pair(0))
          : problem(401, 'unauthenticated', { reason: 'invalid_code' });
    const { signIn, session } = setup(handler);

    const first = await signIn.withPassword('ada@example.test', 'pw');
    expect(first).toEqual({ kind: 'twoFactor', challenge: 'chal-1', expiresAt: '2026-10-14T10:05:00Z' });
    expect(session.state.status).not.toBe('signedIn');

    expect(await signIn.completeTwoFactor('chal-1', '111111')).toEqual({ kind: 'failed', reason: 'invalid_code' });
    expect(await signIn.completeTwoFactor('chal-1', ' 654321 ')).toMatchObject({ kind: 'signedIn' });
    expect(session.state.status).toBe('signedIn');
  });

  it('a spent or expired challenge is invalid_challenge', async () => {
    const { signIn } = setup(() => problem(401, 'unauthenticated', { reason: 'invalid_challenge' }));
    expect(await signIn.completeTwoFactor('old', '123456')).toEqual({ kind: 'failed', reason: 'invalid_challenge' });
  });

  it('a password sign-in the host cannot take a second step for is a plain failure', async () => {
    const { signIn } = setup(() => problem(401, 'step_up_required', { reason: 'two_factor_required' }));
    expect(await signIn.withPassword('a@b.test', 'pw')).toEqual({ kind: 'failed', reason: 'unknown' });
  });

  it('wrong password is invalid_credentials', async () => {
    const { signIn } = setup(() => problem(401, 'unauthenticated', { reason: 'invalid_credentials' }));
    expect(await signIn.withPassword('a@b.test', 'nope')).toEqual({ kind: 'failed', reason: 'invalid_credentials' });
  });
});

describe('Apple', () => {
  const apple = (result: { idToken: string; name?: string } | null, calls: string[] = []) => ({
    isAvailable: async () => true,
    signIn: async (hashed: string) => {
      calls.push(hashed);
      return result;
    },
  });

  it('gives the sheet the SHA-256 of the nonce and sends the raw nonce, with the first-time name', async () => {
    const hashes: string[] = [];
    const { signIn, calls } = setup(ok, { apple: apple({ idToken: 'apple.jwt', name: 'Ada Lovelace' }, hashes) });
    expect(await signIn.withApple()).toMatchObject({ kind: 'signedIn' });
    const sent = calls[0]?.body as { nonce: string; idToken: string; name: string; grantType: string };
    expect(sent).toMatchObject({ grantType: 'apple', idToken: 'apple.jwt', name: 'Ada Lovelace' });
    expect(sent.nonce.length).toBeGreaterThanOrEqual(16);
    expect(hashes).toEqual([hashNonce(sent.nonce)]);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[0]).not.toBe(sent.nonce);
  });

  it('makes a new nonce for every attempt', async () => {
    const { signIn, calls } = setup(ok, { apple: apple({ idToken: 't' }) });
    await signIn.withApple();
    await signIn.withApple();
    expect(calls[0]?.body.nonce).not.toBe(calls[1]?.body.nonce);
  });

  it('a cancelled sheet is not an error and calls nothing', async () => {
    const { signIn, calls } = setup(ok, { apple: apple(null) });
    expect(await signIn.withApple()).toEqual({ kind: 'cancelled' });
    expect(calls).toHaveLength(0);
  });

  it('is unsupported without a provider or when Apple sign-in is unavailable', async () => {
    expect(await setup(ok).signIn.withApple()).toEqual({ kind: 'unsupported' });
    const unavailable = { isAvailable: async () => false, signIn: async () => null };
    expect(await setup(ok, { apple: unavailable }).signIn.withApple()).toEqual({ kind: 'unsupported' });
  });

  it('a token the server refuses (wrong audience, nonce, expiry) is invalid_id_token', async () => {
    const { signIn, session } = setup(() => problem(401, 'unauthenticated', { reason: 'invalid_id_token' }), {
      apple: apple({ idToken: 'bad' }),
    });
    expect(await signIn.withApple()).toEqual({ kind: 'failed', reason: 'invalid_id_token' });
    expect(session.state.status).not.toBe('signedIn');
  });

  it('a provider email that matches an existing account asks for the emailed proof, then links', async () => {
    const handler: Handler = (_p, body) =>
      body.grantType === 'apple'
        ? problem(401, 'step_up_required', { reason: 'email_proof_required', challenge: 'link-1' })
        : body.grantType === 'link_proof' && body.challenge === 'link-1'
          ? json(200, pair(0))
          : problem(401, 'unauthenticated');
    const { signIn } = setup(handler, { apple: apple({ idToken: 't' }) });
    expect(await signIn.withApple()).toEqual({ kind: 'emailProof', challenge: 'link-1', expiresAt: null });
    expect(await signIn.completeLinkProof('link-1', '123456')).toMatchObject({ kind: 'signedIn' });
  });

  it('a sheet that throws is a failure, not a crash', async () => {
    const throwing = { isAvailable: async () => true, signIn: async () => { throw new Error('native'); } };
    expect(await setup(ok, { apple: throwing }).signIn.withApple()).toEqual({ kind: 'failed', reason: 'invalid_id_token' });
  });
});

describe('Google', () => {
  it('passes the raw nonce to Google and to the server', async () => {
    const seen: string[] = [];
    const google = { signIn: async (nonce: string) => (seen.push(nonce), { idToken: 'g.jwt' }) };
    const { signIn, calls } = setup(ok, { google });
    expect(await signIn.withGoogle()).toMatchObject({ kind: 'signedIn' });
    expect(calls[0]?.body).toMatchObject({ grantType: 'google', idToken: 'g.jwt', nonce: seen[0] });
  });

  it('handles a cancelled sheet, no provider and provider_linked_elsewhere', async () => {
    expect(await setup(ok, { google: { signIn: async () => null } }).signIn.withGoogle()).toEqual({ kind: 'cancelled' });
    expect(await setup(ok).signIn.withGoogle()).toEqual({ kind: 'unsupported' });
    const linked = setup(() => problem(401, 'unauthenticated', { reason: 'provider_linked_elsewhere' }), {
      google: { signIn: async () => ({ idToken: 't' }) },
    });
    expect(await linked.signIn.withGoogle()).toEqual({ kind: 'failed', reason: 'provider_linked_elsewhere' });
  });
});

describe('step-up', () => {
  it('asks which proof is needed, then confirms with it', async () => {
    const handler: Handler = (path, body) =>
      path === '/v1/auth/step-up/start'
        ? json(200, { method: 'totp' })
        : body.code === '123456'
          ? json(200, { stepUpAt: 'a', expiresAt: '2026-10-14T10:10:00Z' })
          : problem(400, 'validation_failed', { reason: 'invalid_code' });
    const { signIn } = setup(handler);
    expect(await signIn.startStepUp()).toEqual({ kind: 'method', method: 'totp' });
    expect(await signIn.stepUp({ method: 'totp', code: '000000' })).toEqual({ kind: 'failed', reason: 'invalid_code' });
    expect(await signIn.stepUp({ method: 'totp', code: '123456' })).toEqual({ kind: 'confirmed', expiresAt: '2026-10-14T10:10:00Z' });
  });

  it('reports a wrong password, a rate limit and a dead network', async () => {
    expect(await setup(() => problem(400, 'validation_failed', { reason: 'invalid_password' })).signIn.stepUp({ method: 'password', password: 'x' })).toEqual({ kind: 'failed', reason: 'invalid_password' });
    expect(await setup(() => problem(429, 'rate_limited', { retryAfter: 900 })).signIn.stepUp({ method: 'email', code: '1' })).toEqual({ kind: 'rateLimited', retryAfterSeconds: 900 });
    expect(await setup(() => Promise.reject(new TypeError('x'))).signIn.stepUp({ method: 'email', code: '1' })).toEqual({ kind: 'unavailable' });
  });
});

describe('nonce', () => {
  it('is 64 hex characters and hashes to a different 64 hex characters', () => {
    const n = makeNonce((len) => new Uint8Array(len).fill(7));
    expect(n).toBe('07'.repeat(32));
    expect(hashNonce(n)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('hashes like SHA-256 (known answer for "abc")', () => {
    expect(hashNonce('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
