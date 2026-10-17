import {
  type AppSignIn,
  type Auth,
  type AuthMailer,
  appSignIn,
  consoleMailer,
  createAuth,
  devPersonaReplayExempt,
  idTokenVerifierFromEnv,
  reviewerFixedCodes,
  type SecretSealer,
  twoFactorService,
} from '@yayatoh/auth';
import { isProductionEnv } from '@yayatoh/kernel';
import { IDENTITY_KEY_SCOPE, keyVault } from '@yayatoh/platform';
// Registers the key vault (the composition root) before any seed is opened.
import './ports.ts';

let auth: Auth | undefined;
let signIn: AppSignIn | undefined;

/** TOTP seeds and backup codes are sealed with the KMS key vault, as on the web (roadmap §10). */
const sealer: SecretSealer = {
  seal: async (plaintext) => keyVault().encrypt(IDENTITY_KEY_SCOPE, new TextEncoder().encode(plaintext)),
  open: async (sealed) => new TextDecoder().decode(await keyVault().decrypt(IDENTITY_KEY_SCOPE, sealed)),
};

const devAuthEnabled = () => process.env.YAYATOH_DEV_AUTH === '1' && !isProductionEnv();
const devMailboxKey = (email: string) => `yy-dev-mailbox:${email.toLowerCase()}`;

/**
 * Where this host's auth mail goes. Development logs to the console and, with dev auth on, keeps
 * the last code per address where the web's `/api/dev/last-code` and the app flows can read it
 * (never outside dev auth). Production refuses until a live mail provider is wired here (see
 * docs/owner-inbox.md): a code is never written to a log.
 */
const mailer: AuthMailer = {
  async sendOtp(to, otp, purpose) {
    if (devAuthEnabled()) {
      const c = await getAuth().$context;
      await c.internalAdapter.deleteVerificationByIdentifier(devMailboxKey(to));
      await c.internalAdapter.createVerificationValue({
        identifier: devMailboxKey(to),
        value: otp,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
    }
    await consoleMailer.sendOtp(to, otp, purpose);
  },
  sendMagicLink: (to, url) => consoleMailer.sendMagicLink(to, url),
  sendPasswordReset: (to, url) => consoleMailer.sendPasswordReset?.(to, url) ?? Promise.resolve(),
};

const totpReplayExempt = devPersonaReplayExempt();
/** The store reviewer demo's fixed sign-in code: non-production only, and only when both values are set (M7.5a). */
const fixedEmailCodes = reviewerFixedCodes();

/** Better Auth for api.yayatoh.com, created on first use (the build never needs the secret). */
export function getAuth(): Auth {
  if (!auth) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
    auth = createAuth({
      baseURL: process.env.API_PUBLIC_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:4000',
      secret,
      mailer,
      sealer,
      ...(totpReplayExempt ? { totpReplayExempt } : {}),
      ...(fixedEmailCodes ? { fixedEmailCodes } : {}),
    });
  }
  return auth;
}

/** App sign-in (M7.2a): emailed code, Apple and Google id_tokens, the two-factor step, step-up. */
export function getAppSignIn(): AppSignIn {
  signIn ??= appSignIn(getAuth(), {
    mailer,
    twoFactor: twoFactorService(getAuth(), { mailer, ...(totpReplayExempt ? { totpReplayExempt } : {}) }),
    verifier: idTokenVerifierFromEnv(process.env, { production: isProductionEnv() }),
  });
  return signIn;
}
