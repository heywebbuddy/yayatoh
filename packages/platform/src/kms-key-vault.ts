import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isProductionEnv } from '@yayatoh/kernel';
import { type AwsCredentials, signAwsRequest } from './aws-sigv4.ts';
import { type KeyVault, localKeyVault } from './key-vault.ts';

/**
 * The production key vault (roadmap §10, ADR 0024): envelope encryption with AWS KMS. Each
 * ciphertext carries its own data key, encrypted by the KMS key under the encryption context
 * `{ scope }`, so KMS refuses to open a data key for any other org or platform scope; the body is
 * AES-256-GCM with the scope as additional data (as the local vault). Plain data keys stay in
 * memory for a few minutes so busy paths (ticket signing) do not call KMS on every use.
 *
 * Ciphertext: `kms.v1.<encrypted data key>.<iv>.<body>.<tag>` (base64url parts).
 */
export interface KmsKeyVaultConfig {
  readonly region: string;
  /** Key id, ARN or alias (`alias/yayatoh-prod`). */
  readonly keyId: string;
  readonly credentials: AwsCredentials;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** How long a plain data key is reused for encryption and kept for decryption (default 5 min). */
  readonly cacheMs?: number;
}

const MAX_USES = 1000;
const MAX_CACHED = 2000;

interface CachedKey {
  readonly plain: Buffer;
  readonly blob: string;
  readonly until: number;
  uses: number;
}

export function kmsKeyVault(cfg: KmsKeyVaultConfig): KeyVault {
  const call = cfg.fetch ?? fetch;
  const now = cfg.now ?? (() => new Date());
  const cacheMs = cfg.cacheMs ?? 5 * 60_000;
  const endpoint = `https://kms.${cfg.region}.amazonaws.com/`;
  const forEncrypt = new Map<string, CachedKey>();
  const forDecrypt = new Map<string, CachedKey>();

  async function kms<T>(action: 'GenerateDataKey' | 'Decrypt', payload: object): Promise<T> {
    const body = JSON.stringify(payload);
    const headers = signAwsRequest({
      method: 'POST',
      url: endpoint,
      region: cfg.region,
      service: 'kms',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `TrentService.${action}`,
      },
      body,
      credentials: cfg.credentials,
      now: now(),
    });
    const res = await call(endpoint, { method: 'POST', headers, body });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const type = String(json.__type ?? 'error')
        .split('#')
        .pop();
      throw new Error(`KMS ${action} failed: ${type} (HTTP ${res.status})`);
    }
    return json as T;
  }

  const remember = (map: Map<string, CachedKey>, key: string, value: CachedKey) => {
    if (map.size >= MAX_CACHED) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(key, value);
  };

  async function dataKeyFor(scope: string): Promise<CachedKey> {
    const t = now().getTime();
    const hit = forEncrypt.get(scope);
    if (hit && hit.until > t && hit.uses < MAX_USES) {
      hit.uses += 1;
      return hit;
    }
    const out = await kms<{ Plaintext: string; CiphertextBlob: string }>('GenerateDataKey', {
      KeyId: cfg.keyId,
      KeySpec: 'AES_256',
      EncryptionContext: { scope },
    });
    const entry: CachedKey = {
      plain: Buffer.from(out.Plaintext, 'base64'),
      blob: Buffer.from(out.CiphertextBlob, 'base64').toString('base64url'),
      until: t + cacheMs,
      uses: 1,
    };
    remember(forEncrypt, scope, entry);
    remember(forDecrypt, `${scope}\n${entry.blob}`, entry);
    return entry;
  }

  async function openDataKey(scope: string, blob: string): Promise<Buffer> {
    const t = now().getTime();
    const id = `${scope}\n${blob}`;
    const hit = forDecrypt.get(id);
    if (hit && hit.until > t) return hit.plain;
    const out = await kms<{ Plaintext: string }>('Decrypt', {
      KeyId: cfg.keyId,
      CiphertextBlob: Buffer.from(blob, 'base64url').toString('base64'),
      EncryptionContext: { scope },
    });
    const plain = Buffer.from(out.Plaintext, 'base64');
    remember(forDecrypt, id, { plain, blob, until: t + cacheMs, uses: 0 });
    return plain;
  }

  return {
    async encrypt(scope, plaintext) {
      const key = await dataKeyFor(scope);
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key.plain, iv);
      c.setAAD(Buffer.from(`org:${scope}`));
      const body = Buffer.concat([c.update(plaintext), c.final()]);
      return `kms.v1.${key.blob}.${iv.toString('base64url')}.${body.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
    },
    async decrypt(scope, ciphertext) {
      const [scheme, version, blob, iv, body, tag] = ciphertext.split('.');
      if (scheme !== 'kms' || version !== 'v1' || !blob || !iv || !body || !tag)
        throw new Error('unknown ciphertext format');
      const key = await openDataKey(scope, blob);
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      d.setAAD(Buffer.from(`org:${scope}`));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return new Uint8Array(Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]));
    },
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The key vault from configuration: AWS KMS when `AWS_KMS_KEY_ID` is set (production), else the
 * local vault from `LOCAL_KMS_KEY` (dev, preview, CI; it refuses to run in production), else null.
 */
export function keyVaultFromEnv(env: Env = process.env): KeyVault | null {
  if (env.AWS_KMS_KEY_ID) {
    const missing = ['AWS_KMS_REGION', 'AWS_KMS_ACCESS_KEY_ID', 'AWS_KMS_SECRET_ACCESS_KEY'].filter(
      (k) => !env[k],
    );
    if (missing.length) throw new Error(`AWS_KMS_KEY_ID is set but ${missing.join(', ')} is not`);
    return kmsKeyVault({
      region: env.AWS_KMS_REGION as string,
      keyId: env.AWS_KMS_KEY_ID,
      credentials: {
        accessKeyId: env.AWS_KMS_ACCESS_KEY_ID as string,
        secretAccessKey: env.AWS_KMS_SECRET_ACCESS_KEY as string,
      },
    });
  }
  if (env.LOCAL_KMS_KEY) return localKeyVault(env.LOCAL_KMS_KEY);
  if (isProductionEnv(env)) throw new Error('Production needs AWS_KMS_KEY_ID (the key vault)');
  return null;
}
