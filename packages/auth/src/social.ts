import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { apple, google } from 'better-auth/social-providers';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Auth } from './auth.ts';
import type { AuthMailer } from './mailer.ts';
import { accounts, securityEvents, sessions, trustedDevices, twoFactors, users } from './schema.ts';

/**
 * Google and Apple sign-in (M1.2f). Both run on the app host only (the central login, M1.2d) and
 * behind one port: the real adapters speak OpenID Connect with the owner's client credentials;
 * the fake adapter (development, preview, CI) sends the browser to a fake consent page on this
 * app whose codes are HMAC-signed, like the fake Stripe pages.
 *
 * Linking rules (no pre-hijack takeover, cf. the M2.2 migration guard):
 *  - a provider identity (provider + subject) already linked signs in that account;
 *  - otherwise, if an account with the same email exists, the person must **prove the email** with
 *    a code sent to it before the provider is linked (the provider's "verified" flag alone is not
 *    enough: an address can change hands, and a stale verified flag is how pre-hijacking works). If
 *    that account never verified its email, whoever created it may not own it: its password,
 *    two-step verification, trusted devices and sessions are removed when the link is proved;
 *  - otherwise a new account is created, only for a provider-verified email;
 *  - Apple "Hide my email" addresses (`@privaterelay.appleid.com`) are accepted as the account's
 *    email; they never match another account.
 */
export const SOCIAL_PROVIDERS = ['google', 'apple'] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number];
export const isSocialProvider = (v: unknown): v is SocialProviderId =>
  typeof v === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(v);

export interface SocialProfile {
  readonly provider: SocialProviderId;
  /** The provider's stable user id (OIDC `sub`). */
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
}

export interface SocialAuthorizeInput {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
}

export interface SocialExchangeInput {
  readonly code: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
  /** Apple's form_post `user` JSON (name on the first sign-in only). */
  readonly user?: string | null;
}

/** The port: where to send the browser, and what the returned code proves. */
export interface SocialProvider {
  readonly id: SocialProviderId;
  readonly kind: 'fake' | 'real';
  authorizationUrl(input: SocialAuthorizeInput): Promise<string>;
  /** The profile the code proves, or null (bad, expired or foreign code). */
  exchange(input: SocialExchangeInput): Promise<SocialProfile | null>;
}

const PRIVATE_RELAY = /@privaterelay\.appleid\.com$/i;

/** An Apple "Hide my email" relay address. */
export const isPrivateRelayEmail = (email: string | null | undefined): boolean =>
  Boolean(email && PRIVATE_RELAY.test(email.trim()));

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Fake codes live five minutes, like a real provider's authorization code (roughly). */
export const FAKE_CODE_TTL_MS = 5 * 60_000;

export interface FakeConsent {
  readonly provider: SocialProviderId;
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
  readonly nonce: string;
  readonly redirectUri: string;
}

/** The fake consent page's answer: the consent, signed (HMAC-SHA256), with an expiry. */
export function signFakeCode(secret: string, consent: FakeConsent, now: number = Date.now()): string {
  const body = b64(JSON.stringify({ ...consent, exp: now + FAKE_CODE_TTL_MS }));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** Open a fake code: the signature, the expiry, and the nonce and redirect it was issued for. */
export function openFakeCode(
  secret: string,
  code: string,
  expect: { provider: SocialProviderId; nonce: string; redirectUri: string },
  now: number = Date.now(),
): SocialProfile | null {
  if (code.length > 4096) return null;
  const [body, sig] = code.split('.');
  if (!body || !sig) return null;
  if (!sameText(sig, createHmac('sha256', secret).update(body).digest('base64url'))) return null;
  let c: FakeConsent & { exp: number };
  try {
    c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof c.exp !== 'number' || c.exp <= now) return null;
  if (c.provider !== expect.provider || c.nonce !== expect.nonce || c.redirectUri !== expect.redirectUri)
    return null;
  if (typeof c.subject !== 'string' || !c.subject || typeof c.email !== 'string') return null;
  return {
    provider: c.provider,
    subject: c.subject,
    email: c.email.trim().toLowerCase() || null,
    emailVerified: c.emailVerified === true,
    name: typeof c.name === 'string' ? c.name.slice(0, 200) : null,
  };
}

/** A stable fake subject for an email (the same fake person gets the same id each time). */
export const fakeSubject = (provider: SocialProviderId, email: string) =>
  `fake-${provider}-${sha256(`${provider}:${email.trim().toLowerCase()}`).slice(0, 24)}`;

/** A fresh Apple-style relay address for "Hide my email" on the fake page. */
export const fakeRelayEmail = () => `${randomBytes(8).toString('hex')}@privaterelay.appleid.com`;

/**
 * Development/test adapter: the browser goes to the fake consent page (`consentUrl`), which
 * answers with a signed code. Refused in production by the app's composition root.
 */
export function fakeSocialProvider(
  id: SocialProviderId,
  opts: { secret: string; consentUrl: string },
): SocialProvider {
  return {
    id,
    kind: 'fake',
    async authorizationUrl(input) {
      const u = new URL(opts.consentUrl);
      u.searchParams.set('provider', id);
      u.searchParams.set('state', input.state);
      u.searchParams.set('nonce', input.nonce);
      u.searchParams.set('redirect_uri', input.redirectUri);
      return u.toString();
    },
    async exchange(input) {
      return openFakeCode(opts.secret, input.code, {
        provider: id,
        nonce: input.nonce,
        redirectUri: input.redirectUri,
      });
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth's provider objects are wide generic types.
type AnyProvider = any;

function realProvider(id: SocialProviderId, p: AnyProvider): SocialProvider {
  return {
    id,
    kind: 'real',
    async authorizationUrl(input) {
      const url: URL = await p.createAuthorizationURL({
        state: input.state,
        codeVerifier: input.codeVerifier,
        redirectURI: input.redirectUri,
        additionalParams: { nonce: input.nonce },
      });
      return url.toString();
    },
    async exchange(input) {
      const tokens = await p.validateAuthorizationCode({
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirectURI: input.redirectUri,
      });
      if (!tokens?.idToken) return null;
      // The ID token came straight from the provider's token endpoint (TLS, PKCE); its signature,
      // audience and nonce are still checked.
      const ok = await p.verifyIdToken?.(tokens.idToken, input.nonce);
      if (ok === false) return null;
      let user: unknown;
      try {
        user = input.user ? JSON.parse(input.user) : undefined;
      } catch {
        user = undefined;
      }
      const info = await p.getUserInfo({ ...tokens, user });
      const sub = info?.data?.sub;
      if (!info || typeof sub !== 'string') return null;
      // The nonce we sent must come back in the ID token (Apple may send its SHA-256).
      const nonce = info.data?.nonce;
      if (nonce !== input.nonce && nonce !== sha256(input.nonce)) return null;
      return {
        provider: id,
        subject: sub,
        email: typeof info.user.email === 'string' ? info.user.email.trim().toLowerCase() : null,
        emailVerified: info.user.emailVerified === true,
        name: typeof info.user.name === 'string' && info.user.name ? info.user.name.slice(0, 200) : null,
      };
    },
  };
}

/** Google (OpenID Connect) with the owner's OAuth client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). */
export const googleProvider = (o: { clientId: string; clientSecret: string }): SocialProvider =>
  realProvider('google', google({ clientId: o.clientId, clientSecret: o.clientSecret }));

/**
 * Sign in with Apple with the owner's Services ID (`APPLE_CLIENT_ID`) and client secret (a JWT
 * signed with the Apple key, `APPLE_CLIENT_SECRET`; it lasts at most six months).
 */
export const appleProvider = (o: { clientId: string; clientSecret: string }): SocialProvider =>
  realProvider('apple', apple({ clientId: o.clientId, clientSecret: o.clientSecret }));

// ---------------------------------------------------------------------------------------------
// Linking rules

export type SocialResolution =
  | { readonly kind: 'linked'; readonly userId: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'prove_email'; readonly userId: string; readonly email: string }
  | { readonly kind: 'refused'; readonly reason: 'no_email' | 'email_unverified' };

async function audit(userId: string, action: string, data: Record<string, unknown>) {
  await identityDatabase().insert(securityEvents).values({ id: uuidv7(), userId, action, data });
}

/** What a provider sign-in means for this identity store (see the rules above). */
export async function resolveSocialSignIn(profile: SocialProfile): Promise<SocialResolution> {
  const db = identityDatabase();
  const [link] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(
      and(
        eq(accounts.providerId, profile.provider),
        eq(accounts.accountId, profile.subject),
        isNull(users.deletedAt),
      ),
    );
  if (link) return { kind: 'linked', userId: link.userId };
  if (!profile.email) return { kind: 'refused', reason: 'no_email' };
  if (!profile.emailVerified) return { kind: 'refused', reason: 'email_unverified' };
  const [existing] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${profile.email.toLowerCase()}`, isNull(users.deletedAt)));
  if (existing) return { kind: 'prove_email', userId: existing.id, email: existing.email };
  return { kind: 'create' };
}

/** A new account from a provider-verified profile, linked to it. Returns the new user's id. */
export async function createSocialUser(auth: Auth, profile: SocialProfile): Promise<string> {
  if (!profile.email || !profile.emailVerified) throw new Error('createSocialUser: verified email required');
  const c = await auth.$context;
  const name = profile.name?.trim() || profile.email.split('@')[0] || profile.email;
  const user = await c.internalAdapter.createUser(
    { email: profile.email, name, emailVerified: true },
    { method: 'oauth', oauth: { providerId: profile.provider } },
  );
  await c.internalAdapter.linkAccount({
    userId: user.id,
    providerId: profile.provider,
    accountId: profile.subject,
  });
  await audit(user.id, 'social.account_created', {
    provider: profile.provider,
    privateRelay: isPrivateRelayEmail(profile.email),
  });
  return user.id;
}

export type LinkOutcome = 'linked' | 'already_linked' | 'linked_elsewhere' | 'provider_taken';

/**
 * Link a provider identity to a signed-in person (account security, after step-up). One identity
 * belongs to one account; one account links at most one identity per provider.
 */
export async function linkSocialAccount(
  auth: Auth,
  userId: string,
  profile: SocialProfile,
): Promise<LinkOutcome> {
  const db = identityDatabase();
  const [other] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.providerId, profile.provider), eq(accounts.accountId, profile.subject)));
  if (other) return other.userId === userId ? 'already_linked' : 'linked_elsewhere';
  const [mine] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.providerId, profile.provider), eq(accounts.userId, userId)));
  if (mine) return 'provider_taken';
  const c = await auth.$context;
  await c.internalAdapter.linkAccount({ userId, providerId: profile.provider, accountId: profile.subject });
  await audit(userId, 'social.linked', { provider: profile.provider, proof: 'session' });
  return 'linked';
}

export type UnlinkOutcome = 'unlinked' | 'not_linked' | 'last_method';

/**
 * Unlink a provider (account security, after step-up). Refused when it is the only way in: no
 * password, no other provider, and the account's email is a private relay (emailed codes may not
 * reach it once the relay is gone).
 */
export async function unlinkSocialAccount(
  userId: string,
  provider: SocialProviderId,
): Promise<UnlinkOutcome> {
  const db = identityDatabase();
  const rows = await db
    .select({ id: accounts.id, providerId: accounts.providerId, password: accounts.password })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const target = rows.find((r) => r.providerId === provider);
  if (!target) return 'not_linked';
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const others = rows.filter((r) => r.id !== target.id && (r.providerId !== 'credential' || r.password));
  if (others.length === 0 && isPrivateRelayEmail(u?.email)) return 'last_method';
  await db.delete(accounts).where(and(eq(accounts.id, target.id), eq(accounts.userId, userId)));
  await audit(userId, 'social.unlinked', { provider });
  return 'unlinked';
}

export interface LinkedProvider {
  readonly provider: SocialProviderId;
  readonly linkedAt: Date;
}

/** The providers linked to a person (for account security). */
export async function listSocialAccounts(userId: string): Promise<LinkedProvider[]> {
  const rows = await identityDatabase()
    .select({ provider: accounts.providerId, linkedAt: accounts.createdAt })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), ne(accounts.providerId, 'credential')));
  return rows
    .filter((r): r is { provider: SocialProviderId; linkedAt: Date } => isSocialProvider(r.provider))
    .sort((a, b) => SOCIAL_PROVIDERS.indexOf(a.provider) - SOCIAL_PROVIDERS.indexOf(b.provider));
}

// ---------------------------------------------------------------------------------------------
// Proving the email before linking to an existing account

/** Ten minutes and five tries to type the code sent to the existing account's address. */
export const LINK_PROOF_TTL_MS = 10 * 60_000;
export const LINK_PROOF_ATTEMPTS = 5;

interface PendingLink {
  userId: string;
  provider: SocialProviderId;
  subject: string;
  codeHash: string;
  attempts: number;
}

const proofKey = (id: string) => `yy-social-link:${id}`;
const PROOF_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * Start proving the email: a 6-digit code goes to the existing account's address; the pending
 * link (only its hash of the code) waits ten minutes. Returns the pending id (the browser keeps
 * it in a host-only cookie, so only this browser can finish).
 */
export async function startLinkProof(
  auth: Auth,
  mailer: AuthMailer,
  input: { userId: string; email: string; profile: SocialProfile },
): Promise<string> {
  const c = await auth.$context;
  const id = randomBytes(32).toString('base64url');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const pending: PendingLink = {
    userId: input.userId,
    provider: input.profile.provider,
    subject: input.profile.subject,
    codeHash: sha256(code),
    attempts: 0,
  };
  await c.internalAdapter.createVerificationValue({
    identifier: proofKey(id),
    value: JSON.stringify(pending),
    expiresAt: new Date(Date.now() + LINK_PROOF_TTL_MS),
  });
  await mailer.sendOtp(input.email, code, 'link-account');
  await audit(input.userId, 'social.link_proof_sent', { provider: input.profile.provider });
  return id;
}

/** What is pending (for the page: which provider, whose address), or null. */
export async function pendingLinkProof(
  auth: Auth,
  id: string,
): Promise<{ userId: string; provider: SocialProviderId; email: string } | null> {
  if (!PROOF_ID.test(id)) return null;
  const c = await auth.$context;
  const v = await c.internalAdapter.findVerificationValue(proofKey(id));
  if (!v || v.expiresAt <= new Date()) return null;
  const p = JSON.parse(v.value) as PendingLink;
  const [u] = await identityDatabase()
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, p.userId), isNull(users.deletedAt)));
  return u ? { userId: p.userId, provider: p.provider, email: u.email } : null;
}

export type LinkProofResult =
  | { readonly ok: true; readonly userId: string; readonly reset: boolean }
  | {
      readonly ok: false;
      readonly error: 'invalid_code' | 'expired' | 'too_many_attempts' | 'linked_elsewhere';
    };

/**
 * Finish the proof: a right code links the provider to the account and signs in (the caller makes
 * the session; the second step still applies). If the account had never verified its email, its
 * password, two-step verification, trusted devices and sessions go (pre-hijack guard) and the
 * email is marked verified.
 */
export async function confirmLinkProof(auth: Auth, id: string, code: string): Promise<LinkProofResult> {
  if (!PROOF_ID.test(id)) return { ok: false, error: 'expired' };
  const c = await auth.$context;
  const key = proofKey(id);
  const v = await c.internalAdapter.findVerificationValue(key);
  if (!v || v.expiresAt <= new Date()) return { ok: false, error: 'expired' };
  const p = JSON.parse(v.value) as PendingLink;
  if (p.attempts >= LINK_PROOF_ATTEMPTS) return { ok: false, error: 'too_many_attempts' };
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed) || !sameText(sha256(typed), p.codeHash)) {
    const attempts = p.attempts + 1;
    await c.internalAdapter.updateVerificationByIdentifier(key, {
      value: JSON.stringify({ ...p, attempts }),
    });
    await audit(p.userId, 'social.link_proof_failed', { provider: p.provider });
    return { ok: false, error: attempts >= LINK_PROOF_ATTEMPTS ? 'too_many_attempts' : 'invalid_code' };
  }
  await c.internalAdapter.deleteVerificationByIdentifier(key);
  const db = identityDatabase();
  const [other] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.providerId, p.provider), eq(accounts.accountId, p.subject)));
  if (other && other.userId !== p.userId) return { ok: false, error: 'linked_elsewhere' };
  const [u] = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(and(eq(users.id, p.userId), isNull(users.deletedAt)));
  if (!u) return { ok: false, error: 'expired' };
  const reset = !u.emailVerified;
  if (reset) {
    // Pre-hijack guard: whoever made this unverified account may not own the address.
    await db.transaction(async (tx) => {
      await tx
        .delete(accounts)
        .where(and(eq(accounts.userId, p.userId), eq(accounts.providerId, 'credential')));
      await tx.delete(twoFactors).where(eq(twoFactors.userId, p.userId));
      await tx.delete(sessions).where(eq(sessions.userId, p.userId));
      await tx
        .update(trustedDevices)
        .set({ revokedAt: new Date(), revokedReason: 'password_changed' })
        .where(and(eq(trustedDevices.userId, p.userId), isNull(trustedDevices.revokedAt)));
      await tx
        .update(users)
        .set({ emailVerified: true, twoFactorEnabled: false, updatedAt: new Date() })
        .where(eq(users.id, p.userId));
    });
  }
  if (!other)
    await c.internalAdapter.linkAccount({ userId: p.userId, providerId: p.provider, accountId: p.subject });
  await audit(p.userId, 'social.linked', { provider: p.provider, proof: 'email_code', reset });
  return { ok: true, userId: p.userId, reset };
}
