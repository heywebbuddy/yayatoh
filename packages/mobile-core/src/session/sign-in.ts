/**
 * Sign-in helpers for every grant of `/v1/auth/token` (M7.2a): email code, Apple, Google, password,
 * the two-factor step, the email-proof step for linking a provider to an existing account, and
 * step-up for commands that need a fresh confirmation. Each returns a plain outcome the screen can
 * switch on; none throws for something a person did (a wrong code, a cancelled sheet).
 *
 * The outcome carries a stable `reason` (`details.reason` from the server), never a message to show:
 * screens translate it.
 */
import type { YayatohClient } from '@yayatoh/sdk';
import type { RandomBytes } from '../ports';
import { type ProblemInfo, readProblem, stringDetail } from '../problem';
import { type AppleSignInProvider, type GoogleSignInProvider, hashNonce, makeNonce } from './providers';
import type { SessionStore, SessionUser, TokenPair } from './session-store';

/** A step the server asked for before it will issue tokens. `challenge` is single use. */
export interface PendingStep {
  readonly challenge: string;
  readonly expiresAt: string | null;
}

export type SignInFailure =
  | 'invalid_credentials'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'invalid_challenge'
  | 'invalid_id_token'
  | 'provider_email_missing'
  | 'provider_email_unverified'
  | 'provider_linked_elsewhere'
  | 'unknown';

export type SignInOutcome =
  | { readonly kind: 'signedIn'; readonly user: SessionUser }
  /** The account has two-step verification: ask for an authenticator or backup code. */
  | ({ readonly kind: 'twoFactor' } & PendingStep)
  /** A provider's email matches an existing account: ask for the code emailed to that address. */
  | ({ readonly kind: 'emailProof' } & PendingStep)
  | { readonly kind: 'failed'; readonly reason: SignInFailure }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number | null }
  /** The person closed the Apple or Google sheet. Not an error. */
  | { readonly kind: 'cancelled' }
  /** The sheet is not available on this phone (Apple on Android, no Google client configured). */
  | { readonly kind: 'unsupported' }
  /** No network, a timeout or a 5xx: nothing was decided. */
  | { readonly kind: 'unavailable' };

export type EmailCodeOutcome =
  | { readonly kind: 'sent'; readonly expiresInSeconds: number }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'unavailable' };

export type StepUpMethod = 'totp' | 'password' | 'email';
export type StepUpProof =
  | { readonly method: 'totp' | 'email'; readonly code: string }
  | { readonly method: 'password'; readonly password: string };
export type StepUpOutcome =
  | { readonly kind: 'confirmed'; readonly expiresAt: string }
  | { readonly kind: 'failed'; readonly reason: 'invalid_code' | 'invalid_password' | 'unknown' }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'unavailable' };

const FAILURES: readonly SignInFailure[] = [
  'invalid_credentials',
  'invalid_code',
  'too_many_attempts',
  'invalid_challenge',
  'invalid_id_token',
  'provider_email_missing',
  'provider_email_unverified',
  'provider_linked_elsewhere',
];

function failureOf(p: ProblemInfo): SignInFailure {
  return (FAILURES as readonly (string | null)[]).includes(p.reason) ? (p.reason as SignInFailure) : 'unknown';
}

const retryAfter = (response: Response, p: ProblemInfo): number | null => {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header;
  const detail = Number(p.details.retryAfter);
  return Number.isFinite(detail) && detail > 0 ? detail : null;
};

type ApiResult = { data?: unknown; error?: unknown; response: Response };

export interface SignInDeps {
  /** A client with no token: the sign-in calls are made before there is a session. */
  readonly publicApi: YayatohClient;
  /** The signed-in client, for step-up. */
  readonly api: YayatohClient;
  readonly session: SessionStore;
  readonly random: RandomBytes;
  readonly apple?: AppleSignInProvider;
  readonly google?: GoogleSignInProvider;
}

export function createSignIn(deps: SignInDeps) {
  /** Turns a `/v1/auth/token` answer into an outcome and, on success, stores the tokens. */
  async function finish(call: Promise<ApiResult>): Promise<SignInOutcome> {
    let result: ApiResult;
    try {
      result = await call;
    } catch {
      return { kind: 'unavailable' };
    }
    const { data, error, response } = result;
    if (response.ok && data) {
      const tokens = data as TokenPair;
      await deps.session.setTokens(tokens);
      return { kind: 'signedIn', user: tokens.user };
    }
    const p = readProblem(error, response.status);
    if (response.status === 429 || p.code === 'rate_limited')
      return { kind: 'rateLimited', retryAfterSeconds: retryAfter(response, p) };
    if (response.status >= 500 || response.status === 0) return { kind: 'unavailable' };
    if (p.code === 'step_up_required') {
      const challenge = stringDetail(p, 'challenge');
      if (challenge && (p.reason === 'two_factor_required' || p.reason === 'email_proof_required')) {
        return {
          kind: p.reason === 'two_factor_required' ? 'twoFactor' : 'emailProof',
          challenge,
          expiresAt: stringDetail(p, 'challengeExpiresAt'),
        };
      }
      // A password sign-in on a host that cannot open the second step.
      return { kind: 'failed', reason: 'unknown' };
    }
    return { kind: 'failed', reason: failureOf(p) };
  }


  return {
    /** Emails a six-digit code. The answer is the same for known and unknown addresses. */
    async requestEmailCode(email: string): Promise<EmailCodeOutcome> {
      let result: ApiResult;
      try {
        result = await deps.publicApi.POST('/v1/auth/email-code', { body: { email: email.trim() } });
      } catch {
        return { kind: 'unavailable' };
      }
      const { data, error, response } = result;
      if (response.ok && data) return { kind: 'sent', expiresInSeconds: (data as { expiresInSeconds: number }).expiresInSeconds };
      const p = readProblem(error, response.status);
      if (response.status === 429 || p.code === 'rate_limited')
        return { kind: 'rateLimited', retryAfterSeconds: retryAfter(response, p) };
      return { kind: 'unavailable' };
    },

    withEmailCode: (email: string, code: string) =>
      finish(
        deps.publicApi.POST('/v1/auth/token', {
          body: { grantType: 'email_code', email: email.trim(), code: code.trim() },
        }),
      ),

    withPassword: (email: string, password: string) =>
      finish(
        deps.publicApi.POST('/v1/auth/token', {
          body: { grantType: 'password', email: email.trim(), password },
        }),
      ),

    /** Sign in with Apple. The nonce is made here, hashed for the sheet and sent raw to the server. */
    async withApple(): Promise<SignInOutcome> {
      const apple = deps.apple;
      if (!apple || !(await apple.isAvailable().catch(() => false))) return { kind: 'unsupported' };
      const nonce = makeNonce(deps.random);
      let credential: Awaited<ReturnType<AppleSignInProvider['signIn']>>;
      try {
        credential = await apple.signIn(hashNonce(nonce));
      } catch {
        return { kind: 'failed', reason: 'invalid_id_token' };
      }
      if (!credential) return { kind: 'cancelled' };
      return finish(
        deps.publicApi.POST('/v1/auth/token', {
          body: {
            grantType: 'apple',
            idToken: credential.idToken,
            nonce,
            ...(credential.name ? { name: credential.name } : {}),
          },
        }),
      );
    },

    async withGoogle(): Promise<SignInOutcome> {
      const google = deps.google;
      if (!google) return { kind: 'unsupported' };
      const nonce = makeNonce(deps.random);
      let credential: Awaited<ReturnType<GoogleSignInProvider['signIn']>>;
      try {
        credential = await google.signIn(nonce);
      } catch {
        return { kind: 'failed', reason: 'invalid_id_token' };
      }
      if (!credential) return { kind: 'cancelled' };
      return finish(
        deps.publicApi.POST('/v1/auth/token', {
          body: { grantType: 'google', idToken: credential.idToken, nonce },
        }),
      );
    },

    /** Finishes a `twoFactor` outcome with an authenticator or backup code. */
    completeTwoFactor: (challenge: string, code: string) =>
      finish(
        deps.publicApi.POST('/v1/auth/token', {
          body: { grantType: 'two_factor', challenge, code: code.trim() },
        }),
      ),

    /** Finishes an `emailProof` outcome with the code emailed to the existing account's address. */
    completeLinkProof: (challenge: string, code: string) =>
      finish(
        deps.publicApi.POST('/v1/auth/token', {
          body: { grantType: 'link_proof', challenge, code: code.trim() },
        }),
      ),

    /** Which proof step-up wants (and emails the code when it is an emailed one). */
    async startStepUp(): Promise<{ kind: 'method'; method: StepUpMethod } | { kind: 'unavailable' }> {
      try {
        const { data, response } = await deps.api.POST('/v1/auth/step-up/start');
        if (response.ok && data) return { kind: 'method', method: (data as { method: StepUpMethod }).method };
      } catch {
        // Falls through.
      }
      return { kind: 'unavailable' };
    },

    /** Confirms it is the person, so commands that need a recent step-up pass for a few minutes. */
    async stepUp(proof: StepUpProof): Promise<StepUpOutcome> {
      let result: ApiResult;
      try {
        result = await deps.api.POST('/v1/auth/step-up', { body: proof });
      } catch {
        return { kind: 'unavailable' };
      }
      const { data, error, response } = result;
      if (response.ok && data) return { kind: 'confirmed', expiresAt: (data as { expiresAt: string }).expiresAt };
      const p = readProblem(error, response.status);
      if (response.status === 429 || p.code === 'rate_limited')
        return { kind: 'rateLimited', retryAfterSeconds: retryAfter(response, p) };
      if (response.status === 400)
        return {
          kind: 'failed',
          reason: p.reason === 'invalid_code' || p.reason === 'invalid_password' ? p.reason : 'unknown',
        };
      return response.status >= 500 ? { kind: 'unavailable' } : { kind: 'failed', reason: 'unknown' };
    },
  };
}

export type SignIn = ReturnType<typeof createSignIn>;
