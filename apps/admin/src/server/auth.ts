import 'server-only';
import {
  type Auth,
  consoleMailer,
  createAuth,
  devPersonaReplayExempt,
  type SecretSealer,
  type TwoFactorService,
  twoFactorService,
} from '@yayatoh/auth';
import { IDENTITY_KEY_SCOPE, type KeyVault, localKeyVault } from '@yayatoh/platform';

let instance: Auth | undefined;
const exempt = devPersonaReplayExempt();
let vault: KeyVault | undefined;

// AWS KMS arrives with the owner's AWS account; until then dev/preview/CI use the local vault.
function identityVault(): KeyVault {
  if (!vault) {
    const key = process.env.LOCAL_KMS_KEY;
    if (!key) throw new Error('LOCAL_KMS_KEY is not set (see .env.example)');
    vault = localKeyVault(key);
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
    instance = createAuth({
      baseURL: process.env.ADMIN_AUTH_URL ?? 'http://localhost:3001',
      secret,
      mailer: consoleMailer,
      cookieNamespace: 'admin',
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
    mailer: consoleMailer,
    ...(exempt ? { totpReplayExempt: exempt } : {}),
  });
  return twoFactor;
}
