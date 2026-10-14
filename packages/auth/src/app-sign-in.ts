import { createHash, randomBytes } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import type { Auth } from './auth.ts';
import type { IdTokenVerifier } from './id-token.ts';
import type { AuthMailer } from './mailer.ts';
import { refreshTokenService, revokeAllRefreshTokens, type TokenPair } from './refresh-tokens.ts';
import { securityEvents, verifications } from './schema.ts';
import {
  confirmLinkProof,
  createSocialUser,
  LINK_PROOF_TTL_MS,
  resetUnverifiedAccount,
  resolveSocialSignIn,
  type SocialProviderId,
  startLinkProof,
} from './social.ts';
import {
  isTwoFactorError,
  type StepUpMethod,
  type StepUpProof,
  type TwoFactorService,
} from './two-factor.ts';

/**
 * Sign-in for the mobile apps (M7.2a, decision P7-5): an emailed code, a native Apple or Google
 * id_token, and the second step for people with two-step verification. Every path ends in the same
 * place as the password grant: a 15-minute access token and a rotating refresh token.
 *
 *  - **Email code**: the first sign-in creates the account with the address verified (the code
 *    proves it); later sign-ins use that account. Requests answer the same for known and unknown
 *    addresses.
 *  - **Apple and Google**: the id_token is checked by the {@link IdTokenVerifier} port. Linking to
 *    an existing account follows the web's rules (`social.ts`): a provider identity already linked
 *    signs in; the same email on an existing account needs the person to prove the address with a
 *    code emailed to it first; otherwise a new account. A private-relay Apple address never matches
 *    another account.
 *  - **Two-step verification**: every first factor (password, code, provider) on an account with
 *    TOTP ends in a single-use challenge instead of tokens. It lasts five minutes, allows five
 *    wrong codes, and is spent by the first right TOTP or backup code.
 *  - **Step-up** on a bearer session: a TOTP, password or emailed code stamps the session so
 *    commands marked `stepUp` pass for the next `STEP_UP_WINDOW_MS`.
 */
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const CHALLENGE_ATTEMPTS = 5;
/** How long an emailed sign-in code lasts (the emailOTP plugin's `expiresIn`). */
export const EMAIL_CODE_TTL_SECONDS = 600;

const CHALLENGE_SHAPE = /^yyc_[A-Za-z0-9_-]{43}$/;
const challengeKey = (token: string) =>
  `yy-app-challenge:${createHash('sha256').update(token).digest('hex')}`;

export interface AppChallenge {
  /** What the client sends back with the code. */
  readonly token: string;
  readonly expiresAt: Date;
}

export type AppSignInRefusal =
  | 'invalid_code'
  | 'too_many_attempts'
  | 'rate_limited'
  | 'invalid_challenge'
  | 'invalid_id_token'
  | 'provider_email_missing'
  | 'provider_email_unverified'
  | 'provider_linked_elsewhere';

export type AppSignInResult =
  | { readonly ok: true; readonly tokens: TokenPair }
  /** The account has two-step verification: answer with `completeTwoFactor`. */
  | { readonly ok: false; readonly reason: 'two_factor_required'; readonly challenge: AppChallenge }
  /** An account with this address exists: prove the address with the emailed code (`completeLinkProof`). */
  | { readonly ok: false; readonly reason: 'link_proof_required'; readonly challenge: AppChallenge }
  | { readonly ok: false; readonly reason: AppSignInRefusal };

export interface AppSignInOptions {
  /** Where link-proof and step-up codes go. */
  readonly mailer: AuthMailer;
  readonly twoFactor: TwoFactorService;
  readonly verifier: IdTokenVerifier;
  readonly now?: () => Date;
}

async function audit(userId: string, action: string, data: Record<string, unknown>, at: Date) {
  await identityDatabase()
    .insert(securityEvents)
    .values({ id: uuidv7(), userId, action, data, createdAt: at });
}

const errorCodeOf = (err: unknown): string | undefined =>
  (err as { body?: { code?: string } } | null)?.body?.code;

/** A wrong, spent, expired or over-tried emailed code, as the refusal the caller reports. */
function otpRefusal(err: unknown): { ok: false; reason: AppSignInRefusal } | null {
  const code = errorCodeOf(err);
  if (code === 'TOO_MANY_ATTEMPTS') return { ok: false, reason: 'too_many_attempts' };
  if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED' || code === 'INVALID_EMAIL')
    return { ok: false, reason: 'invalid_code' };
  return null;
}

export function appSignIn(auth: Auth, opts: AppSignInOptions) {
  const now = opts.now ?? (() => new Date());
  const tokens = refreshTokenService(auth, { now });
  const normalise = (email: string) => email.trim().toLowerCase();

  async function openChallenge(userId: string): Promise<AppChallenge> {
    const c = await auth.$context;
    const token = `yyc_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(now().getTime() + CHALLENGE_TTL_MS);
    await c.internalAdapter.createVerificationValue({
      identifier: challengeKey(token),
      value: JSON.stringify({ userId, attempts: 0 }),
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** The first factor is done for this person: tokens, or the second step when they use TOTP. */
  async function finish(userId: string, method: string): Promise<AppSignInResult> {
    const c = await auth.$context;
    const user = await c.internalAdapter.findUserById(userId);
    if (!user || (user as { deletedAt?: Date | null }).deletedAt)
      return { ok: false, reason: 'invalid_challenge' };
    if ((user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) {
      await audit(userId, 'app_sign_in.second_step_required', { method }, now());
      return { ok: false, reason: 'two_factor_required', challenge: await openChallenge(userId) };
    }
    const pair = await tokens.issue(userId);
    await audit(userId, 'app_sign_in.signed_in', { method }, now());
    return { ok: true, tokens: pair };
  }

  /**
   * An emailed code spent on an account that never verified its address (a password sign-up that
   * stopped there). Better Auth's own path for this case cannot run on our verification table, so
   * the code is checked and spent here, then the web's pre-hijack guard applies: the password,
   * two-step verification, trusted devices and sessions of the unproven account are removed.
   */
  async function spendOnUnverified(userId: string, address: string, otp: string): Promise<AppSignInResult> {
    try {
      await auth.api.checkVerificationOTP({ body: { email: address, type: 'sign-in', otp } });
    } catch (err) {
      const refusal = otpRefusal(err);
      if (refusal) return refusal;
      throw err;
    }
    const spent = await identityDatabase()
      .delete(verifications)
      .where(eq(verifications.identifier, `sign-in-otp-${address}`))
      .returning({ id: verifications.id });
    if (spent.length === 0) return { ok: false, reason: 'invalid_code' };
    await resetUnverifiedAccount(userId);
    await audit(userId, 'app_sign_in.unverified_account_reset', {}, now());
    return finish(userId, 'email_code');
  }

  return {
    /**
     * Email a six-digit sign-in code. Known and unknown addresses take the same path (an unknown
     * one is a sign-up), so the caller's answer cannot tell them apart.
     */
    async requestEmailCode(email: string): Promise<{ expiresInSeconds: number }> {
      await auth.api.sendVerificationOTP({ body: { email: normalise(email), type: 'sign-in' } });
      return { expiresInSeconds: EMAIL_CODE_TTL_SECONDS };
    },

    /** Spend an emailed code: the account (made on the first sign-in) with its address verified. */
    async signInWithEmailCode(email: string, code: string): Promise<AppSignInResult> {
      const address = normalise(email);
      const otp = code.replace(/\s/g, '');
      if (!/^\d{6}$/.test(otp)) return { ok: false, reason: 'invalid_code' };
      const c = await auth.$context;
      const existing = await c.internalAdapter.findUserByEmail(address);
      if (existing && !existing.user.emailVerified) return spendOnUnverified(existing.user.id, address, otp);
      let res: Awaited<ReturnType<typeof auth.api.signInEmailOTP>>;
      try {
        res = await auth.api.signInEmailOTP({ body: { email: address, otp } });
      } catch (err) {
        const refusal = otpRefusal(err);
        if (refusal) return refusal;
        throw err;
      }
      if ('twoFactorRedirect' in res && res.twoFactorRedirect) {
        // The web's challenge (a cookie nobody here holds) was opened and the session dropped.
        const found = await c.internalAdapter.findUserByEmail(address);
        if (!found) return { ok: false, reason: 'invalid_code' };
        await audit(found.user.id, 'app_sign_in.second_step_required', { method: 'email_code' }, now());
        return {
          ok: false,
          reason: 'two_factor_required',
          challenge: await openChallenge(found.user.id),
        };
      }
      if (!('token' in res) || !res.token) return { ok: false, reason: 'invalid_code' };
      // The code is checked; the 14-day session it made is not what this client gets.
      await c.internalAdapter.deleteSession(res.token);
      const userId = res.user.id;
      if (!res.user.name)
        await c.internalAdapter.updateUser(userId, { name: address.split('@')[0] ?? address });
      return finish(userId, 'email_code');
    },

    /** The first factor was a password the caller checked, and the account has TOTP: open its challenge. */
    async challengeForPassword(email: string): Promise<AppChallenge | null> {
      const c = await auth.$context;
      const found = await c.internalAdapter.findUserByEmail(normalise(email));
      if (!found) return null;
      await audit(found.user.id, 'app_sign_in.second_step_required', { method: 'password' }, now());
      return openChallenge(found.user.id);
    },

    /** A native Apple or Google id_token (see {@link IdTokenVerifier} for what is checked). */
    async signInWithIdToken(input: {
      provider: SocialProviderId;
      idToken: string;
      nonce: string;
      /** Apple sends the name once, outside the token. */
      name?: string | null;
    }): Promise<AppSignInResult> {
      const verified = await opts.verifier.verify(input);
      if (!verified) return { ok: false, reason: 'invalid_id_token' };
      const profile =
        verified.name || !input.name ? verified : { ...verified, name: input.name.trim() || null };
      const resolution = await resolveSocialSignIn(profile);
      switch (resolution.kind) {
        case 'linked':
          return finish(resolution.userId, profile.provider);
        case 'create': {
          const userId = await createSocialUser(auth, profile);
          return finish(userId, profile.provider);
        }
        case 'prove_email': {
          const id = await startLinkProof(auth, opts.mailer, {
            userId: resolution.userId,
            email: resolution.email,
            profile,
          });
          return {
            ok: false,
            reason: 'link_proof_required',
            challenge: { token: id, expiresAt: new Date(now().getTime() + LINK_PROOF_TTL_MS) },
          };
        }
        case 'refused':
          return {
            ok: false,
            reason: resolution.reason === 'no_email' ? 'provider_email_missing' : 'provider_email_unverified',
          };
      }
    },

    /** The code emailed to an existing account's address, after a provider sign-in matched it. */
    async completeLinkProof(challenge: string, code: string): Promise<AppSignInResult> {
      const r = await confirmLinkProof(auth, challenge, code);
      if (r.ok) return finish(r.userId, 'link_proof');
      if (r.error === 'invalid_code') return { ok: false, reason: 'invalid_code' };
      if (r.error === 'too_many_attempts') return { ok: false, reason: 'too_many_attempts' };
      if (r.error === 'linked_elsewhere') return { ok: false, reason: 'provider_linked_elsewhere' };
      return { ok: false, reason: 'invalid_challenge' };
    },

    /** The second step: the challenge from a first factor, and a TOTP or backup code. */
    async completeTwoFactor(challenge: string, code: string): Promise<AppSignInResult> {
      if (!CHALLENGE_SHAPE.test(challenge)) return { ok: false, reason: 'invalid_challenge' };
      const c = await auth.$context;
      const key = challengeKey(challenge);
      const v = await c.internalAdapter.findVerificationValue(key);
      if (!v || v.expiresAt <= now()) {
        if (v) await c.internalAdapter.deleteVerificationByIdentifier(key);
        return { ok: false, reason: 'invalid_challenge' };
      }
      const pending = JSON.parse(v.value) as { userId: string; attempts: number };
      if (pending.attempts >= CHALLENGE_ATTEMPTS) {
        await c.internalAdapter.deleteVerificationByIdentifier(key);
        return { ok: false, reason: 'too_many_attempts' };
      }
      try {
        await opts.twoFactor.verifySignInCode(pending.userId, code.trim());
      } catch (err) {
        if (!isTwoFactorError(err)) throw err;
        if (err.code === 'rate_limited') return { ok: false, reason: 'rate_limited' };
        if (err.code !== 'invalid_code') {
          await c.internalAdapter.deleteVerificationByIdentifier(key);
          return { ok: false, reason: 'invalid_challenge' };
        }
        const attempts = pending.attempts + 1;
        if (attempts >= CHALLENGE_ATTEMPTS) {
          await c.internalAdapter.deleteVerificationByIdentifier(key);
          return { ok: false, reason: 'too_many_attempts' };
        }
        await c.internalAdapter.updateVerificationByIdentifier(key, {
          value: JSON.stringify({ ...pending, attempts }),
        });
        return { ok: false, reason: 'invalid_code' };
      }
      // Single use: only the request that deletes the row gets tokens.
      const spent = await identityDatabase()
        .delete(verifications)
        .where(eq(verifications.identifier, key))
        .returning({ id: verifications.id });
      if (spent.length === 0) return { ok: false, reason: 'invalid_challenge' };
      const pair = await tokens.issue(pending.userId);
      await audit(pending.userId, 'app_sign_in.signed_in', { method: 'two_factor' }, now());
      return { ok: true, tokens: pair };
    },

    /**
     * How this person confirms it's them for a step-up (the app shows the right field), emailing
     * the code first when the method is an emailed code.
     */
    async startStepUp(userId: string, email: string): Promise<StepUpMethod> {
      const method = await opts.twoFactor.method(userId);
      if (method === 'email') await opts.twoFactor.sendStepUpEmail(userId, email);
      return method;
    },

    /**
     * Sign out everywhere (M7.3a): every session of the person ends (the web's, tenant hosts, API
     * clients) and every refresh-token family is revoked, so no phone can refresh its way back in.
     * Audited. Returns how many refresh-token families were revoked.
     */
    async signOutEverywhere(userId: string): Promise<number> {
      const at = now();
      await opts.twoFactor.signOutEverywhere(userId);
      const families = await revokeAllRefreshTokens(userId, at, 'signed_out');
      await audit(userId, 'app_sign_in.signed_out_everywhere', { families }, at);
      return families;
    },

    /** Check the proof and stamp the bearer session; returns the time stamped. Throws `TwoFactorError`. */
    stepUp(input: { userId: string; sessionToken: string; proof: StepUpProof }): Promise<Date> {
      return opts.twoFactor.stepUp(input);
    },
  };
}

export type AppSignIn = ReturnType<typeof appSignIn>;
