import 'server-only';
import {
  type Auth,
  createAuth,
  devPersonaReplayExempt,
  type SecretSealer,
  type TwoFactorService,
  twoFactorService,
} from '@yayatoh/auth';
import { IDENTITY_KEY_SCOPE, type KeyVault, keyVaultFromEnv } from '@yayatoh/platform';
import { staffMailer } from './mail.ts';

let instance: Auth | undefined;
const exempt = devPersonaReplayExempt();
let vault: KeyVault | undefined;

// AWS KMS in production (AWS_KMS_KEY_ID); dev/preview/CI use the local vault (LOCAL_KMS_KEY).
function identityVault(): KeyVault {
  if (!vault) {
    const v = keyVaultFromEnv();
    if (!v) throw new Error('No key vault: set AWS_KMS_KEY_ID or LOCAL_KMS_KEY (see .env.example)');
    vault = v;
  }
  return vault;
}

/** TOTP seeds are sealed with the same key vault as the web (one identity store). */
const sealer: SecretSealer = {
  seal: async (plaintext) => identityVault().encrypt(IDENTITY_KEY_SCOPE, new TextEncoder().encode(plaintext)),
  open: async (sealed) => new TextDecoder().decode(await identityVault().decrypt(IDENTITY_KEY_SCOPE, sealed)),
};

/**
 * Better Auth for the staff console (admin.yayatoh.com): its own session cookie, so a web
 * session never signs anyone in here. Staff still need an entry in `platform.staff`. People with
 * two-step verification on answer the same challenge here (M1.2c).
 */
export function getAuth(): Auth {
  if (!instance) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
    const baseURL = process.env.ADMIN_AUTH_URL ?? 'http://localhost:3001';
    instance = createAuth({
      baseURL,
      secret,
      mailer: staffMailer,
      cookieNamespace: 'admin',
      // Staff passkeys (M1.2f): rpID is the registrable domain (`yayatoh.com` in production, set by
      // PASSKEY_RP_ID) or this console's host name; only this console's origin may use them.
      passkey: {
        rpID: process.env.PASSKEY_RP_ID || new URL(baseURL).hostname,
        origin: baseURL,
        rpName: 'Yayatoh staff',
      },
      sealer,
      // Dev personas' derived authenticator secrets only (dev auth on, never in production).
      ...(exempt ? { totpReplayExempt: exempt } : {}),
    });
  }
  return instance;
}

let twoFactor: TwoFactorService | undefined;

/**
 * Step-up for staff (M1.13d): the same "confirm it's you" check as the web (authenticator code,
 * else password), recorded on the console session and audited in packages/auth.
 */
export function getTwoFactor(): TwoFactorService {
  twoFactor ??= twoFactorService(getAuth(), {
    mailer: staffMailer,
    ...(exempt ? { totpReplayExempt: exempt } : {}),
  });
  return twoFactor;
}
