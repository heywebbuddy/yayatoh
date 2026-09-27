import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for secrets we must store (ticket signing keys, OAuth tokens, TOTP seeds).
 * Production uses AWS KMS with a per-org data key (roadmap §10; owner account pending).
 * Dev/preview/CI use the local adapter with LOCAL_KMS_KEY; it refuses to run in production.
 *
 * The first argument is the key scope: an org id for tenant secrets, or a platform scope such
 * as `platform:identity` for global secrets (users' TOTP seeds). A ciphertext only opens under
 * the scope it was sealed with.
 */
export interface KeyVault {
  encrypt(orgId: string, plaintext: Uint8Array): Promise<string>;
  decrypt(orgId: string, ciphertext: string): Promise<Uint8Array>;
}

/** The key scope for global identity secrets (TOTP seeds and backup codes). */
export const IDENTITY_KEY_SCOPE = 'platform:identity';

/** AES-256-GCM with the scope (org id) as additional data, so a ciphertext cannot move between orgs. */
export function localKeyVault(masterKeyHex: string): KeyVault {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The local key vault is not allowed in production');
  const key = Buffer.from(masterKeyHex, 'hex');
  if (key.length !== 32) throw new Error('LOCAL_KMS_KEY must be 32 bytes of hex');
  return {
    async encrypt(orgId, plaintext) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(`org:${orgId}`));
      const body = Buffer.concat([c.update(plaintext), c.final()]);
      return `local.v1.${iv.toString('base64url')}.${body.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
    },
    async decrypt(orgId, ciphertext) {
      const [scheme, version, iv, body, tag] = ciphertext.split('.');
      if (scheme !== 'local' || version !== 'v1' || !iv || !body || !tag)
        throw new Error('unknown ciphertext format');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      d.setAAD(Buffer.from(`org:${orgId}`));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return new Uint8Array(Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]));
    },
  };
}

let registered: KeyVault | null = null;

/** Register the vault in each app's composition root. */
export function setKeyVault(v: KeyVault): void {
  registered = v;
}

export function keyVault(): KeyVault {
  if (!registered) throw new Error('No KeyVault registered (composition root)');
  return registered;
}
