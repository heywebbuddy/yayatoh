import { createHash } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  fakeIdTokenVerifier,
  idTokenAudiencesFromEnv,
  idTokenVerifierFromEnv,
  jwksIdTokenVerifier,
  signFakeIdToken,
} from '../src/id-token.ts';

// The real adapter against a local key set standing in for Apple's and Google's JWKS.
const APPLE_AUD = 'com.yayatoh.app';
const GOOGLE_AUD = 'google-ios-client.apps.googleusercontent.com';
const audiences = { apple: [APPLE_AUD], google: [GOOGLE_AUD, 'google-android-client'] };
const NONCE = 'n-0123456789abcdef';
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const nowS = Math.floor(NOW / 1000);

let signing: CryptoKey;
let foreign: CryptoKey;
let verifier: ReturnType<typeof jwksIdTokenVerifier>;

beforeAll(async () => {
  const good = await generateKeyPair('RS256', { extractable: true });
  const bad = await generateKeyPair('RS256');
  signing = good.privateKey;
  foreign = bad.privateKey;
  const jwk: JWK = { ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  verifier = jwksIdTokenVerifier({ audiences, keys: { apple: keys, google: keys }, now: () => NOW });
});

interface Overrides {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string | undefined;
  email?: string | undefined;
  email_verified?: boolean | string;
  key?: CryptoKey;
  alg?: string;
}

function token(provider: 'apple' | 'google', o: Overrides = {}) {
  const claims: Record<string, unknown> = {
    email: 'sam@example.test',
    email_verified: true,
    nonce: provider === 'apple' ? createHash('sha256').update(NONCE).digest('hex') : NONCE,
    ...('nonce' in o ? { nonce: o.nonce } : {}),
    ...('email' in o ? { email: o.email } : {}),
    ...('email_verified' in o ? { email_verified: o.email_verified } : {}),
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: (o.alg ?? 'RS256') as 'RS256', kid: 'k1' })
    .setIssuer(o.iss ?? (provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com'))
    .setAudience(o.aud ?? (provider === 'apple' ? APPLE_AUD : GOOGLE_AUD))
    .setSubject(o.sub ?? 'subject-1')
    .setIssuedAt(o.iat ?? nowS - 5)
    .setExpirationTime(o.exp ?? nowS + 600)
    .sign(o.key ?? signing);
}

const verify = (provider: 'apple' | 'google', idToken: string, nonce = NONCE) =>
  verifier.verify({ provider, idToken, nonce });

describe('id_token verification (real adapter, local keys)', () => {
  it('accepts a valid Apple token (nonce carried as its SHA-256) and a valid Google token', async () => {
    expect(await verify('apple', await token('apple'))).toEqual({
      provider: 'apple',
      subject: 'subject-1',
      email: 'sam@example.test',
      emailVerified: true,
      name: null,
    });
    expect(await verify('google', await token('google'))).toMatchObject({
      provider: 'google',
      email: 'sam@example.test',
      emailVerified: true,
    });
    // The second Google issuer spelling is real too.
    expect(await verify('google', await token('google', { iss: 'accounts.google.com' }))).not.toBeNull();
    // Any of the apps' own client ids.
    expect(await verify('google', await token('google', { aud: 'google-android-client' }))).not.toBeNull();
  });

  it('reads Apple’s string-valued email_verified', async () => {
    const p = await verify('apple', await token('apple', { email_verified: 'true' }));
    expect(p?.emailVerified).toBe(true);
    const q = await verify('apple', await token('apple', { email_verified: 'false' }));
    expect(q?.emailVerified).toBe(false);
  });

  it('refuses a wrong audience (another app’s client id, or the other provider’s)', async () => {
    expect(await verify('apple', await token('apple', { aud: 'com.someone.else' }))).toBeNull();
    expect(await verify('google', await token('google', { aud: APPLE_AUD }))).toBeNull();
  });

  it('refuses a wrong issuer', async () => {
    expect(await verify('apple', await token('apple', { iss: 'https://evil.example' }))).toBeNull();
    // A Google-issued token is not an Apple sign-in.
    expect(await verify('apple', await token('apple', { iss: 'https://accounts.google.com' }))).toBeNull();
    expect(await verify('google', await token('google', { iss: 'https://appleid.apple.com' }))).toBeNull();
  });

  it('refuses a bad signature (another key, a tampered body, a stripped signature)', async () => {
    expect(await verify('apple', await token('apple', { key: foreign }))).toBeNull();
    const good = await token('google');
    const [h, , s] = good.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: GOOGLE_AUD,
        sub: 'someone-else',
        exp: nowS + 600,
        nonce: NONCE,
      }),
    ).toString('base64url');
    expect(await verify('google', `${h}.${forgedBody}.${s}`)).toBeNull();
    expect(await verify('google', `${h}.${forgedBody}.`)).toBeNull();
    expect(await verify('google', 'not-a-jwt')).toBeNull();
    expect(await verify('google', '')).toBeNull();
  });

  it('refuses an unsigned (alg none) token', async () => {
    const body = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${body({ alg: 'none', typ: 'JWT' })}.${body({
      iss: 'https://accounts.google.com',
      aud: GOOGLE_AUD,
      sub: 'x',
      exp: nowS + 600,
      nonce: NONCE,
    })}.`;
    expect(await verify('google', none)).toBeNull();
  });

  it('refuses an expired token, but not one inside the clock tolerance', async () => {
    expect(await verify('apple', await token('apple', { exp: nowS - 120 }))).toBeNull();
    expect(await verify('google', await token('google', { exp: nowS - 120 }))).toBeNull();
    expect(await verify('google', await token('google', { exp: nowS - 10 }))).not.toBeNull();
  });

  it('refuses a token issued in the future', async () => {
    expect(await verify('google', await token('google', { iat: nowS + 3600, exp: nowS + 7200 }))).toBeNull();
  });

  it('refuses a mismatched or missing nonce', async () => {
    expect(await verify('apple', await token('apple'), 'a-different-nonce')).toBeNull();
    expect(await verify('google', await token('google'), 'a-different-nonce')).toBeNull();
    expect(await verify('google', await token('google', { nonce: undefined }))).toBeNull();
    // Apple's token holds the hash; the raw nonce in the token is not what Apple would send.
    expect(await verify('apple', await token('apple', { nonce: NONCE }))).toBeNull();
    // Google's holds the nonce as given; a hash of it is not accepted there.
    expect(
      await verify(
        'google',
        await token('google', { nonce: createHash('sha256').update(NONCE).digest('hex') }),
      ),
    ).toBeNull();
    expect(await verify('google', await token('google'), '')).toBeNull();
  });

  it('refuses every token for a provider with no audiences configured', async () => {
    const closed = jwksIdTokenVerifier({
      audiences: { apple: [], google: audiences.google },
      keys: { apple: createLocalJWKSet({ keys: [] }), google: createLocalJWKSet({ keys: [] }) },
    });
    expect(
      await closed.verify({ provider: 'apple', idToken: await token('apple'), nonce: NONCE }),
    ).toBeNull();
  });
});

describe('id_token verification (fake adapter)', () => {
  const secret = 'f'.repeat(64);
  const fake = fakeIdTokenVerifier({ secret, audiences, now: () => NOW });
  const claims = { sub: 'fake-1', email: 'fay@example.test', nonce: NONCE };

  it('applies the same claims rules to tokens signed with the shared secret', async () => {
    const ok = signFakeIdToken(secret, { provider: 'apple', audience: APPLE_AUD, ...claims }, NOW);
    expect(await fake.verify({ provider: 'apple', idToken: ok, nonce: NONCE })).toMatchObject({
      subject: 'fake-1',
      email: 'fay@example.test',
      emailVerified: true,
    });
    const g = signFakeIdToken(secret, { provider: 'google', audience: GOOGLE_AUD, ...claims }, NOW);
    expect(await fake.verify({ provider: 'google', idToken: g, nonce: NONCE })).not.toBeNull();
    // One provider's token never signs in as the other.
    expect(await fake.verify({ provider: 'apple', idToken: g, nonce: NONCE })).toBeNull();
    // Wrong audience, nonce, expiry, issuer, signature.
    const bad = (c: object, s = secret) =>
      signFakeIdToken(s, { provider: 'google', audience: GOOGLE_AUD, ...claims, ...c }, NOW);
    for (const t of [
      bad({ audience: 'other' }),
      bad({ ttlSeconds: -120 }),
      bad({ issuer: 'https://evil.example' }),
      bad({}, 'e'.repeat(64)),
      `${g.slice(0, -2)}xx`,
    ])
      expect(await fake.verify({ provider: 'google', idToken: t, nonce: NONCE })).toBeNull();
    expect(await fake.verify({ provider: 'google', idToken: g, nonce: 'other' })).toBeNull();
  });
});

describe('composition from the environment', () => {
  it('reads comma-separated audiences', () => {
    expect(
      idTokenAudiencesFromEnv({ APPLE_MOBILE_CLIENT_IDS: ' a.b , c.d ', GOOGLE_MOBILE_CLIENT_IDS: '' }),
    ).toEqual({ apple: ['a.b', 'c.d'], google: [] });
  });

  it('is real in production and fake elsewhere unless opted in', () => {
    const env = { BETTER_AUTH_SECRET: 's'.repeat(40) };
    expect(idTokenVerifierFromEnv(env, { production: true }).kind).toBe('real');
    expect(idTokenVerifierFromEnv(env, { production: false }).kind).toBe('fake');
    expect(
      idTokenVerifierFromEnv({ ...env, MOBILE_SOCIAL_SIGN_IN_PROVIDER: 'real' }, { production: false }).kind,
    ).toBe('real');
    expect(() => idTokenVerifierFromEnv({}, { production: false })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
