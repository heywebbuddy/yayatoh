import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import type { SocialProfile, SocialProviderId } from './social.ts';

/**
 * Native Apple and Google sign-in (M7.2a): the app signs in with the platform's own sheet and
 * sends the provider's **id_token**. This is the port that proves what the token says. The real
 * adapter checks the signature against the provider's JWKS (fetched and cached by `jose`), then
 * `iss`, `aud` (the apps' own client ids), `exp` and the nonce. The fake adapter (development,
 * preview, CI) checks the same claims on a token signed with a shared secret instead of a key.
 *
 * Nonce: the app makes a random nonce per attempt and sends it with the token. Apple's sheet takes
 * the SHA-256 (hex) of it and puts that in the token; Google's carries it as given.
 */
export interface IdTokenVerifier {
  readonly kind: 'fake' | 'real';
  /** The profile a valid token proves, or null (any reason: the caller never says which). */
  verify(input: {
    provider: SocialProviderId;
    idToken: string;
    nonce: string;
  }): Promise<SocialProfile | null>;
}

const ISSUERS: Record<SocialProviderId, readonly string[]> = {
  apple: ['https://appleid.apple.com'],
  google: ['https://accounts.google.com', 'accounts.google.com'],
};

export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** The app ids a token may be issued to, per provider (the apps' bundle ids and client ids). */
export type IdTokenAudiences = Readonly<Record<SocialProviderId, readonly string[]>>;

/** Clock skew allowed on `exp` (seconds). */
const CLOCK_TOLERANCE_S = 30;

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const truthy = (v: unknown) => v === true || v === 'true';

/**
 * The claims checks both adapters share (the signature is checked by the caller): issuer,
 * audience, expiry and issue time, the nonce, and a stable subject. Returns the profile or null.
 */
export function profileFromClaims(
  provider: SocialProviderId,
  claims: JWTPayload & Record<string, unknown>,
  expect: { audiences: readonly string[]; nonce: string; now: number },
): SocialProfile | null {
  const nowS = Math.floor(expect.now / 1000);
  if (typeof claims.iss !== 'string' || !ISSUERS[provider].includes(claims.iss)) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a) => typeof a === 'string' && expect.audiences.includes(a))) return null;
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_TOLERANCE_S <= nowS) return null;
  // Freshness is the nonce's job (one per attempt, inside the token); a token from the future is not valid.
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_TOLERANCE_S > nowS) return null;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) return null;
  if (typeof claims.nonce !== 'string' || !expect.nonce) return null;
  const wanted = provider === 'apple' ? sha256Hex(expect.nonce) : expect.nonce;
  if (!sameText(claims.nonce, wanted)) return null;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const name = typeof claims.name === 'string' ? claims.name.trim().slice(0, 200) : '';
  return {
    provider,
    subject: claims.sub,
    email: email && email.length <= 254 ? email : null,
    emailVerified: truthy(claims.email_verified),
    name: name || null,
  };
}

export interface JwksIdTokenOptions {
  readonly audiences: IdTokenAudiences;
  /** The providers' signing keys. Default: their published JWKS, fetched and cached. */
  readonly keys?: Readonly<Record<SocialProviderId, JWTVerifyGetKey>>;
  readonly now?: () => number;
}

/** The providers' published signing keys, fetched on demand and cached by `jose`. */
export function remoteJwks(): Record<SocialProviderId, JWTVerifyGetKey> {
  return {
    apple: createRemoteJWKSet(new URL(APPLE_JWKS_URL), { cacheMaxAge: 60 * 60_000 }),
    google: createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), { cacheMaxAge: 60 * 60_000 }),
  };
}

/** The real adapter: signature against the provider's JWKS, then the shared claims checks. */
export function jwksIdTokenVerifier(opts: JwksIdTokenOptions): IdTokenVerifier {
  const keys = opts.keys ?? remoteJwks();
  const now = opts.now ?? Date.now;
  return {
    kind: 'real',
    async verify({ provider, idToken, nonce }) {
      const audiences = opts.audiences[provider];
      if (audiences.length === 0) return null;
      if (idToken.length > 8192) return null;
      try {
        const { payload } = await jwtVerify(idToken, keys[provider], {
          // Both providers sign with RS256; nothing else (never `none`, never a shared secret).
          algorithms: ['RS256'],
          issuer: [...ISSUERS[provider]],
          audience: [...audiences],
          clockTolerance: CLOCK_TOLERANCE_S,
          currentDate: new Date(now()),
        });
        return profileFromClaims(provider, payload, { audiences, nonce, now: now() });
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fake adapter (development, preview, CI): claims signed with HMAC-SHA256 under a shared secret.

const b64 = (s: string) => Buffer.from(s).toString('base64url');

export interface FakeIdTokenClaims {
  readonly provider: SocialProviderId;
  readonly sub: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly name?: string;
  /** The raw nonce the app generated (the fake token applies the provider's own nonce rule). */
  readonly nonce: string;
  readonly audience: string;
  /** Seconds the token lasts from `now` (default 600). */
  readonly ttlSeconds?: number;
  readonly issuer?: string;
}

/** A fake id_token for tests and fake-mode apps: `fake.<claims>.<signature>`. */
export function signFakeIdToken(secret: string, c: FakeIdTokenClaims, now: number = Date.now()): string {
  const nowS = Math.floor(now / 1000);
  const body = b64(
    JSON.stringify({
      iss: c.issuer ?? ISSUERS[c.provider][0],
      aud: c.audience,
      sub: c.sub,
      iat: nowS,
      exp: nowS + (c.ttlSeconds ?? 600),
      nonce: c.provider === 'apple' ? sha256Hex(c.nonce) : c.nonce,
      email: c.email,
      email_verified: c.emailVerified ?? true,
      name: c.name,
      provider: c.provider,
    }),
  );
  return `fake.${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function fakeIdTokenVerifier(opts: {
  readonly secret: string;
  readonly audiences: IdTokenAudiences;
  readonly now?: () => number;
}): IdTokenVerifier {
  const now = opts.now ?? Date.now;
  return {
    kind: 'fake',
    async verify({ provider, idToken, nonce }) {
      const [tag, body, sig] = idToken.split('.');
      if (tag !== 'fake' || !body || !sig || idToken.length > 8192) return null;
      if (!sameText(sig, createHmac('sha256', opts.secret).update(body).digest('base64url'))) return null;
      let claims: JWTPayload & Record<string, unknown>;
      try {
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      // The token names its provider; one provider's token never signs in as the other.
      if (claims.provider !== provider) return null;
      return profileFromClaims(provider, claims, { audiences: opts.audiences[provider], nonce, now: now() });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Composition

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The audiences from the environment (`.env.example`): `APPLE_MOBILE_CLIENT_IDS` (the iOS bundle
 * ids) and `GOOGLE_MOBILE_CLIENT_IDS` (the iOS, Android and web OAuth client ids the apps sign in
 * with), comma separated.
 */
export function idTokenAudiencesFromEnv(env: Record<string, string | undefined>): IdTokenAudiences {
  return { apple: list(env.APPLE_MOBILE_CLIENT_IDS), google: list(env.GOOGLE_MOBILE_CLIENT_IDS) };
}

/**
 * The verifier for a host. Production is always `real`; elsewhere `MOBILE_SOCIAL_SIGN_IN_PROVIDER=real`
 * opts in and the default is `fake` (signed with a key derived from `BETTER_AUTH_SECRET`). A provider
 * with no audiences configured refuses every token.
 */
export function idTokenVerifierFromEnv(
  env: Record<string, string | undefined>,
  opts: { production: boolean },
): IdTokenVerifier {
  const audiences = idTokenAudiencesFromEnv(env);
  const real = opts.production || env.MOBILE_SOCIAL_SIGN_IN_PROVIDER === 'real';
  if (real) return jwksIdTokenVerifier({ audiences });
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
  return fakeIdTokenVerifier({ secret: fakeIdTokenSecret(secret), audiences });
}

/** The fake id_token signing key: derived from BETTER_AUTH_SECRET (dev, preview and CI only). */
export const fakeIdTokenSecret = (authSecret: string): string =>
  createHmac('sha256', authSecret).update('yayatoh:fake-native-id-token').digest('hex');
