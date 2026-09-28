import {
  type Auth,
  type AuthMailer,
  consoleMailer,
  createAuth,
  type SecretSealer,
  type TwoFactorService,
  twoFactorService,
} from '@yayatoh/auth';
import { IDENTITY_KEY_SCOPE, keyVault, liftErasedAccountMail } from '@yayatoh/platform';
import { devAuthEnabled } from './dev.ts';
// Registers the key vault (the composition root) before any seed is sealed.
import './ports.ts';

let instance: Auth | undefined;
let twoFactor: TwoFactorService | undefined;

/** TOTP seeds and backup codes are sealed with the KMS key vault (roadmap §10). */
const sealer: SecretSealer = {
  seal: async (plaintext) => keyVault().encrypt(IDENTITY_KEY_SCOPE, new TextEncoder().encode(plaintext)),
  open: async (sealed) => new TextDecoder().decode(await keyVault().decrypt(IDENTITY_KEY_SCOPE, sealed)),
};

/**
 * Development only: the last one-time code sent to each address, so persona tools and the e2e
 * suite can read "emailed" codes (`/api/dev/last-code`). Kept in the verifications table (any server
 * process can read it) and never written outside dev auth.
 */
const devMailboxKey = (email: string) => `yy-dev-mailbox:${email.toLowerCase()}`;

async function rememberDevCode(email: string, code: string) {
  const c = await getAuth().$context;
  await c.internalAdapter.deleteVerificationByIdentifier(devMailboxKey(email));
  await c.internalAdapter.createVerificationValue({
    identifier: devMailboxKey(email),
    value: code,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
}

export async function devLastCode(email: string): Promise<string | null> {
  if (!devAuthEnabled()) return null;
  const c = await getAuth().$context;
  return (await c.internalAdapter.findVerificationValue(devMailboxKey(email)))?.value ?? null;
}

// SES arrives with M1.10 (owner account pending); until then codes are logged in dev only.
const mailer: AuthMailer = {
  async sendOtp(to, otp, purpose) {
    if (devAuthEnabled()) await rememberDevCode(to, otp);
    await consoleMailer.sendOtp(to, otp, purpose);
  },
  sendMagicLink: (to, url) => consoleMailer.sendMagicLink(to, url),
};

/** Better Auth for this host, created on first use (the build never needs the secret). */
export function getAuth(): Auth {
  if (!instance) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
    instance = createAuth({
      baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
      secret,
      mailer,
      sealer,
      // Someone whose address was erased signs up again (M1.14e): account mail reaches them again;
      // org marketing still needs a new consent from them.
      onUserCreated: async (user) => {
        await liftErasedAccountMail(user.email);
      },
    });
  }
  return instance;
}

/** Two-step verification and step-up for people on this host. */
export function getTwoFactor(): TwoFactorService {
  twoFactor ??= twoFactorService(getAuth(), { mailer });
  return twoFactor;
}
