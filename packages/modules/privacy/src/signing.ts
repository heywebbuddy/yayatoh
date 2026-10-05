import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify } from 'node:crypto';

/**
 * Signs data-subject archives and erasure receipts (M6.1c). Ed25519, so anyone holding the
 * public key (printed on every receipt and shipped in every archive) can check that a receipt or
 * manifest came from Yayatoh and was not changed. Production signs with a key held in AWS KMS
 * (owner inbox); dev, preview and CI derive a local key from APP_TOKEN_SECRET.
 */
export interface DsarSigner {
  /** Short id of the key (first 16 hex of the SHA-256 of the public key). */
  readonly keyId: string;
  readonly publicKeyPem: string;
  sign(data: Uint8Array): Promise<string>;
}

/** PKCS#8 prefix of an Ed25519 private key; the 32-byte seed follows. */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

export function localDsarSigner(secret: string): DsarSigner {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The local DSAR signer is not allowed in production');
  if (secret.length < 32) throw new Error('The DSAR signer needs a secret of at least 32 characters');
  const seed = Buffer.from(hkdfSync('sha256', secret, 'yayatoh', 'dsar-signing-key/v1', 32));
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  const publicKeyPem = createPublicKey(key).export({ format: 'pem', type: 'spki' }).toString();
  return {
    keyId: keyIdOf(publicKeyPem),
    publicKeyPem,
    async sign(data) {
      return sign(null, data, key).toString('base64');
    },
  };
}

export const keyIdOf = (publicKeyPem: string) =>
  createHash('sha256').update(publicKeyPem.trim()).digest('hex').slice(0, 16);

/** Checks a signature made by `sign` (receipts, archive manifests). */
export function verifyDsarSignature(publicKeyPem: string, data: Uint8Array, signature: string): boolean {
  try {
    return verify(null, data, createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

let registered: DsarSigner | null = null;

/** Register the signer in the composition root (production: the KMS adapter). */
export function setDsarSigner(s: DsarSigner): void {
  registered = s;
}

export function dsarSigner(): DsarSigner {
  if (!registered) {
    const secret = process.env.APP_TOKEN_SECRET;
    if (!secret) throw new Error('No DSAR signer registered and APP_TOKEN_SECRET is not set');
    registered = localDsarSigner(secret);
  }
  return registered;
}

/** JSON with keys in sorted order at every level: what is signed. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object' && !(v instanceof Date))
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    return v;
  };
  return JSON.stringify(norm(value));
}
