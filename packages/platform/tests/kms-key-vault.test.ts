import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keyVaultFromEnv, kmsKeyVault } from '../src/kms-key-vault.ts';

/**
 * A stand-in for AWS KMS: data keys are wrapped with a master key under the encryption context,
 * as KMS does, so a wrong scope fails to unwrap. It records every call and its signed headers.
 */
function fakeKms() {
  const master = randomBytes(32);
  const calls: { target: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const wrap = (key: Buffer, ctx: string) => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', master, iv);
    c.setAAD(Buffer.from(ctx));
    const out = Buffer.concat([iv, c.update(key), c.final(), c.getAuthTag()]);
    return out.toString('base64');
  };
  const unwrap = (blob: string, ctx: string) => {
    const b = Buffer.from(blob, 'base64');
    const d = createDecipheriv('aes-256-gcm', master, b.subarray(0, 12));
    d.setAAD(Buffer.from(ctx));
    d.setAuthTag(b.subarray(b.length - 16));
    return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
  };
  const fetch = (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const target = headers['x-amz-target'] ?? '';
    calls.push({ target, headers, body });
    const ctx = JSON.stringify(body.EncryptionContext);
    if (body.KeyId !== 'alias/yayatoh-test')
      return new Response(JSON.stringify({ __type: 'NotFoundException' }), { status: 400 });
    if (target === 'TrentService.GenerateDataKey') {
      const key = randomBytes(32);
      return Response.json({ Plaintext: key.toString('base64'), CiphertextBlob: wrap(key, ctx) });
    }
    try {
      return Response.json({ Plaintext: unwrap(String(body.CiphertextBlob), ctx).toString('base64') });
    } catch {
      return new Response(JSON.stringify({ __type: 'com.amazonaws.kms#InvalidCiphertextException' }), {
        status: 400,
      });
    }
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' };

describe('AWS KMS key vault', () => {
  it('round-trips, binds the ciphertext to its scope and rejects tampering', async () => {
    const kms = fakeKms();
    const v = kmsKeyVault({
      region: 'us-east-1',
      keyId: 'alias/yayatoh-test',
      credentials,
      fetch: kms.fetch,
    });
    const secret = new Uint8Array([1, 2, 3, 4]);
    const c = await v.encrypt('org-a', secret);
    expect(c.startsWith('kms.v1.')).toBe(true);
    expect(await v.decrypt('org-a', c)).toEqual(secret);
    await expect(v.decrypt('org-b', c)).rejects.toThrow(/InvalidCiphertextException/);
    const parts = c.split('.');
    const body = parts[4] as string;
    parts[4] = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
    await expect(v.decrypt('org-a', parts.join('.'))).rejects.toThrow();
    await expect(v.decrypt('org-a', 'local.v1.a.b.c')).rejects.toThrow(/unknown ciphertext format/);
  });

  it('signs each call for the kms service and sends the scope as encryption context', async () => {
    const kms = fakeKms();
    const v = kmsKeyVault({
      region: 'us-east-1',
      keyId: 'alias/yayatoh-test',
      credentials,
      fetch: kms.fetch,
    });
    await v.encrypt('org-a', new Uint8Array([9]));
    const [call] = kms.calls;
    expect(call?.target).toBe('TrentService.GenerateDataKey');
    expect(call?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/kms\//,
    );
    expect(call?.headers['content-type']).toBe('application/x-amz-json-1.1');
    expect(call?.body).toMatchObject({ KeySpec: 'AES_256', EncryptionContext: { scope: 'org-a' } });
  });

  it('reuses data keys for a few minutes, then asks KMS again', async () => {
    const kms = fakeKms();
    let t = Date.parse('2026-10-05T12:00:00Z');
    const v = kmsKeyVault({
      region: 'us-east-1',
      keyId: 'alias/yayatoh-test',
      credentials,
      fetch: kms.fetch,
      now: () => new Date(t),
    });
    const a = await v.encrypt('org-a', new Uint8Array([1]));
    const b = await v.encrypt('org-a', new Uint8Array([2]));
    await v.decrypt('org-a', a);
    await v.decrypt('org-a', b);
    expect(kms.calls.map((c) => c.target)).toEqual(['TrentService.GenerateDataKey']);
    t += 6 * 60_000;
    await v.decrypt('org-a', a);
    await v.encrypt('org-a', new Uint8Array([3]));
    expect(kms.calls.map((c) => c.target)).toEqual([
      'TrentService.GenerateDataKey',
      'TrentService.Decrypt',
      'TrentService.GenerateDataKey',
    ]);
  });

  it('surfaces KMS errors by type, never the response body', async () => {
    const kms = fakeKms();
    const v = kmsKeyVault({ region: 'us-east-1', keyId: 'alias/other', credentials, fetch: kms.fetch });
    await expect(v.encrypt('org-a', new Uint8Array([1]))).rejects.toThrow(
      'KMS GenerateDataKey failed: NotFoundException (HTTP 400)',
    );
  });
});

describe('keyVaultFromEnv', () => {
  it('picks KMS when configured and names what is missing', () => {
    expect(
      keyVaultFromEnv({
        AWS_KMS_KEY_ID: 'alias/x',
        AWS_KMS_REGION: 'us-east-1',
        AWS_KMS_ACCESS_KEY_ID: 'a',
        AWS_KMS_SECRET_ACCESS_KEY: 'b',
      }),
    ).not.toBeNull();
    expect(() => keyVaultFromEnv({ AWS_KMS_KEY_ID: 'alias/x', AWS_KMS_REGION: 'us-east-1' })).toThrow(
      'AWS_KMS_KEY_ID is set but AWS_KMS_ACCESS_KEY_ID, AWS_KMS_SECRET_ACCESS_KEY is not',
    );
  });

  it('falls back to the local vault, and refuses production without KMS', () => {
    expect(keyVaultFromEnv({ LOCAL_KMS_KEY: randomBytes(32).toString('hex') })).not.toBeNull();
    expect(keyVaultFromEnv({})).toBeNull();
    expect(() => keyVaultFromEnv({ YAYATOH_ENV: 'production' })).toThrow(/AWS_KMS_KEY_ID/);
  });
});
