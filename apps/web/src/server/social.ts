import 'server-only';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  appleProvider,
  fakeSocialProvider,
  googleProvider,
  isSocialProvider,
  type SocialProvider,
  type SocialProviderId,
} from '@yayatoh/auth';
import { getAuth } from './auth.ts';
import { appOrigin } from './tenant-return.ts';

/**
 * Google and Apple sign-in (M1.2f) for the app host. `SOCIAL_SIGN_IN_PROVIDER=real` uses the
 * owner's OAuth clients (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`/
 * `APPLE_CLIENT_SECRET`; a provider without both is not offered); `fake` (the default outside
 * production) sends the browser to the fake consent page `/auth/social/fake`. Production never
 * uses the fake adapter.
 */
const production = () => process.env.VERCEL_ENV === 'production';

export function socialMode(): 'fake' | 'real' {
  if (production()) return 'real';
  return process.env.SOCIAL_SIGN_IN_PROVIDER === 'real' ? 'real' : 'fake';
}

/** The fake consent page's signing key: derived from BETTER_AUTH_SECRET (dev, preview and CI only). */
export function fakeSocialSecret(): string {
  if (production()) throw new Error('fake social sign-in is disabled in production');
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
  return createHmac('sha256', secret).update('yayatoh:fake-social-sign-in').digest('hex');
}

const cache = new Map<SocialProviderId, SocialProvider | null>();

/** The adapter for a provider, or null when it isn't configured. */
export function socialProvider(id: SocialProviderId): SocialProvider | null {
  if (cache.has(id)) return cache.get(id) ?? null;
  let p: SocialProvider | null = null;
  if (socialMode() === 'fake') {
    p = fakeSocialProvider(id, { secret: fakeSocialSecret(), consentUrl: `${appOrigin()}/auth/social/fake` });
  } else if (id === 'google' && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    p = googleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    });
  } else if (id === 'apple' && process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
    p = appleProvider({
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
    });
  }
  cache.set(id, p);
  return p;
}

/** The providers offered on the sign-in page and in account security. */
export function enabledSocialProviders(): SocialProviderId[] {
  return (['google', 'apple'] as const).filter((id) => socialProvider(id) !== null);
}

/** Where the provider sends the browser back (registered with Google/Apple; no locale). */
export const socialRedirectUri = (id: SocialProviderId) => `${appOrigin()}/auth/social/${id}/callback`;

/** The browser's half of a pending provider sign-in: a host-only cookie holding the state. */
export const socialStateCookie = (https: boolean) => (https ? '__Host-yy.oauth' : 'yy.oauth');
export const SOCIAL_STATE_MAX_AGE_S = 600;

/** The pending link proof's browser binding (see social.ts in packages/auth). */
export const linkProofCookie = (https: boolean) => (https ? '__Host-yy.link' : 'yy.link');
export const LINK_PROOF_MAX_AGE_S = 600;

export interface PendingSocial {
  readonly provider: SocialProviderId;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly locale: string;
  /** Sign in (the sign-in page) or link to the signed-in person (account security). */
  readonly intent: 'sign_in' | 'link';
  /** For `link`: the person who started it (must still be the one signed in). */
  readonly userId: string | null;
  /** Where to go after signing in on this host (a path). */
  readonly next: string;
  /** Signing in for a tenant site (M1.2d): where to hand the person back to, and its state. */
  readonly handoff: { readonly returnUrl: string; readonly state: string } | null;
}

const stateKey = (state: string) => `yy-oauth-state:${createHash('sha256').update(state).digest('hex')}`;
const STATE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Start a provider sign-in: a random state (the cookie holds it; the server keeps what it stands
 * for, 10 minutes), a PKCE verifier and a nonce. Returns the provider URL and the state.
 */
export async function beginSocial(
  pending: Omit<PendingSocial, 'codeVerifier' | 'nonce'>,
): Promise<{ url: string; state: string } | null> {
  const provider = socialProvider(pending.provider);
  if (!provider) return null;
  const state = randomBytes(32).toString('base64url');
  const full: PendingSocial = {
    ...pending,
    codeVerifier: randomBytes(32).toString('base64url'),
    nonce: randomBytes(16).toString('base64url'),
  };
  const c = await getAuth().$context;
  await c.internalAdapter.createVerificationValue({
    identifier: stateKey(state),
    value: JSON.stringify(full),
    expiresAt: new Date(Date.now() + SOCIAL_STATE_MAX_AGE_S * 1000),
  });
  const url = await provider.authorizationUrl({
    state,
    codeVerifier: full.codeVerifier,
    nonce: full.nonce,
    redirectUri: socialRedirectUri(pending.provider),
  });
  return { url, state };
}

/**
 * Take the pending sign-in for a returned state (single use): the state must match this browser's
 * cookie and the provider in the path. Null for anything else.
 */
export async function takeSocial(
  provider: string,
  state: string | null,
  cookie: string | null | undefined,
): Promise<PendingSocial | null> {
  if (!state || !cookie || !STATE.test(state) || state !== cookie || !isSocialProvider(provider)) return null;
  const c = await getAuth().$context;
  const v = await c.internalAdapter.findVerificationValue(stateKey(state));
  if (!v) return null;
  await c.internalAdapter.deleteVerificationByIdentifier(stateKey(state));
  if (new Date(v.expiresAt) <= new Date()) return null;
  const p = JSON.parse(v.value) as PendingSocial;
  return p.provider === provider ? p : null;
}
