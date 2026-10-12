import {
  type Auth,
  type AuthMailer,
  consoleMailer,
  createAuth,
  devPersonaReplayExempt,
  type SecretSealer,
  type TwoFactorService,
  twoFactorService,
} from '@yayatoh/auth';
import { LOCALES } from '@yayatoh/contracts';
import { isProductionEnv } from '@yayatoh/kernel';
import { type MessageKind, PLATFORM_SENDER, renderMessage } from '@yayatoh/notifications';
import { IDENTITY_KEY_SCOPE, keyVault, liftErasedAccountMail } from '@yayatoh/platform';
import { cookies } from 'next/headers.js';
import { sendLiveAuthMail } from '../lib/auth-mail-policy.ts';
import { devAuthEnabled } from './dev.ts';
import { webTransports } from './mail-transports.ts';
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

export async function rememberDevCode(email: string, code: string) {
  const c = await getAuth().$context;
  await c.internalAdapter.deleteVerificationByIdentifier(devMailboxKey(email));
  await c.internalAdapter.createVerificationValue({
    identifier: devMailboxKey(email),
    value: code,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
}

/** Development only: the last password-reset link "emailed" to an address (e2e, M1.2f). */
const devLinkKey = (email: string) => `yy-dev-link:${email.toLowerCase()}`;

async function rememberDevLink(email: string, url: string) {
  const c = await getAuth().$context;
  await c.internalAdapter.deleteVerificationByIdentifier(devLinkKey(email));
  await c.internalAdapter.createVerificationValue({
    identifier: devLinkKey(email),
    value: url,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
}

export async function devLastLink(email: string): Promise<string | null> {
  if (!devAuthEnabled()) return null;
  const c = await getAuth().$context;
  return (await c.internalAdapter.findVerificationValue(devLinkKey(email)))?.value ?? null;
}

export async function devLastCode(email: string): Promise<string | null> {
  if (!devAuthEnabled()) return null;
  const c = await getAuth().$context;
  return (await c.internalAdapter.findVerificationValue(devMailboxKey(email)))?.value ?? null;
}

/** The visitor's language (next-intl's cookie), else English. */
async function mailLocale(): Promise<string> {
  try {
    const l = (await cookies()).get('NEXT_LOCALE')?.value;
    return l && (LOCALES as readonly string[]).includes(l) ? l : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Production: sign-in mail goes out at once through the live email provider (`webTransports`),
 * in the visitor's language. Without a provider it fails loudly: the code or link is never
 * written to a log.
 */
async function sendAuthMail(
  kind: Extract<MessageKind, 'auth.sign-in-code' | 'auth.password-reset' | 'auth.magic-link'>,
  to: string,
  params: Readonly<Record<string, string | number>>,
): Promise<void> {
  const t = webTransports();
  if (!t) throw new Error('No email provider is configured for sign-in email (EMAIL_PROVIDER=ses)');
  if (process.env.EMAIL_PROVIDER === 'ses' && t.email.name !== 'ses')
    throw new Error('AWS SES is selected but its required email configuration is incomplete');
  const rendered = renderMessage({
    kind,
    locale: await mailLocale(),
    params,
    org: { name: 'Yayatoh', brandColor: null, poweredByVisible: false },
  });
  await t.email.send({
    from: { name: 'Yayatoh', address: PLATFORM_SENDER },
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {},
    idempotencyKey: `auth-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
}

const production = () => process.env.NODE_ENV === 'production' && isProductionEnv();

// Explicit SES configuration sends real account mail locally too. Unconfigured development
// keeps the console mailer and the dev code store. Code 10 min, link 15, reset 30.
export const authMailer: AuthMailer = {
  async sendOtp(to, otp, purpose) {
    if (sendLiveAuthMail(production(), process.env.EMAIL_PROVIDER))
      return sendAuthMail('auth.sign-in-code', to, { code: otp, minutes: 10 });
    if (devAuthEnabled()) await rememberDevCode(to, otp);
    await consoleMailer.sendOtp(to, otp, purpose);
  },
  async sendMagicLink(to, url) {
    if (sendLiveAuthMail(production(), process.env.EMAIL_PROVIDER))
      return sendAuthMail('auth.magic-link', to, { url, minutes: 15 });
    await consoleMailer.sendMagicLink(to, url);
  },
  async sendPasswordReset(to, url) {
    if (sendLiveAuthMail(production(), process.env.EMAIL_PROVIDER))
      return sendAuthMail('auth.password-reset', to, { url, minutes: 30 });
    if (devAuthEnabled()) await rememberDevLink(to, url);
    await consoleMailer.sendPasswordReset?.(to, url);
  },
};

/** TOTP replay protection skips only the seeded dev personas' derived secrets, with dev auth on. */
const totpReplayExempt = devPersonaReplayExempt();

/** Better Auth for this host, created on first use (the build never needs the secret). */
export function getAuth(): Auth {
  if (!instance) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
    instance = createAuth({
      baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
      secret,
      mailer: authMailer,
      sealer,
      ...(totpReplayExempt ? { totpReplayExempt } : {}),
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
  twoFactor ??= twoFactorService(getAuth(), {
    mailer: authMailer,
    ...(totpReplayExempt ? { totpReplayExempt } : {}),
  });
  return twoFactor;
}
