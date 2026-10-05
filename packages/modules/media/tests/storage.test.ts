import { describe, expect, it } from 'vitest';
import { mediaStoreFromEnv } from '../src/storage/config.ts';
import { assertOrgKey } from '../src/storage/port.ts';
import { presignV4, r2MediaStore, signV4 } from '../src/storage/r2.ts';

const ORG = '0190f2a4-1c2b-7cde-8f00-000000000001';
const OTHER = '0190f2a4-1c2b-7cde-8f00-000000000002';
const ASSET = '0190f2a4-1c2b-7cde-8f00-00000000000a';
const FILE = `640-${'a'.repeat(32)}.webp`;

describe('AWS Signature V4 (R2 adapter)', () => {
  it('matches the published S3 GET Object example', () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html, "GET Object".
    const h = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 's3',
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('the adapter signs PUT/GET/list/DELETE for the org prefix only, and never leaves the stub', async () => {
    const calls: { method: string; url: string; auth: string }[] = [];
    const store = r2MediaStore({
      accountId: 'acct',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      bucket: 'media',
      now: () => new Date('2026-09-01T00:00:00Z'),
      fetch: (async (url: URL, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        calls.push({ method: init.method ?? 'GET', url: String(url), auth: headers.authorization ?? '' });
        if (init.method === 'GET' && String(url).includes('list-type'))
          return new Response(
            `<ListBucketResult><Contents><Key>${ORG}/${ASSET}/${FILE}</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>`,
          );
        if (init.method === 'GET') return new Response('missing', { status: 404 });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });
    await store.put(ORG, `${ORG}/${ASSET}/${FILE}`, new Uint8Array([1, 2, 3]), 'image/webp');
    expect(await store.get(ORG, `${ORG}/${ASSET}/${FILE}`)).toBeNull();
    await store.deleteAsset(ORG, ASSET);
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET', 'GET', 'DELETE']);
    expect(calls[0]?.url).toBe(`https://acct.r2.cloudflarestorage.com/media/${ORG}/${ASSET}/${FILE}`);
    expect(calls[2]?.url).toContain(`prefix=${encodeURIComponent(`${ORG}/${ASSET}/`)}`);
    for (const c of calls)
      expect(c.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/20260901\/auto\/s3\/aws4_request, /);
    await expect(
      store.put(OTHER, `${ORG}/${ASSET}/${FILE}`, new Uint8Array(1), 'image/webp'),
    ).rejects.toThrow(/org prefix/);
    expect(calls).toHaveLength(4);
  });
});

describe('storage keys and configuration', () => {
  it('keys are {org}/{asset}/{variant file}, nothing else', () => {
    expect(() => assertOrgKey(ORG, `${ORG}/${ASSET}/${FILE}`)).not.toThrow();
    for (const bad of [
      `${OTHER}/${ASSET}/${FILE}`,
      `${ORG}/${ASSET}/../${FILE}`,
      `${ORG}/${ASSET}/sub/${FILE}`,
      `${ORG}/not-a-uuid/${FILE}`,
      `${ORG}/${ASSET}/secret.txt`,
      `/${ORG}/${ASSET}/${FILE}`,
    ])
      expect(() => assertOrgKey(ORG, bad)).toThrow(/org prefix/);
  });

  it('postgres by default, r2 with its credentials, never postgres in production', () => {
    expect(mediaStoreFromEnv({}).kind).toBe('postgres');
    expect(
      mediaStoreFromEnv({
        MEDIA_STORE: 'r2',
        R2_ACCOUNT_ID: 'a',
        R2_ACCESS_KEY_ID: 'b',
        R2_SECRET_ACCESS_KEY: 'c',
        R2_MEDIA_BUCKET: 'd',
      }).kind,
    ).toBe('r2');
    expect(() => mediaStoreFromEnv({ MEDIA_STORE: 'r2' })).toThrow(/needs R2_ACCOUNT_ID/);
    expect(() => mediaStoreFromEnv({ VERCEL_ENV: 'production' })).toThrow(/development only/);
    expect(() => mediaStoreFromEnv({ MEDIA_STORE: 's3' })).toThrow(/Unknown MEDIA_STORE/);
  });
});

describe('presigned PUT (M4.5b)', () => {
  it('matches AWS’s published query-string signing example', () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html (GET example).
    const url = presignV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: {},
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 's3',
      now: new Date('2013-05-24T00:00:00Z'),
      expiresInSeconds: 86400,
    });
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('the R2 store signs a PUT for exactly the declared size, inside the org prefix only', () => {
    const store = r2MediaStore({
      accountId: 'acct',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      bucket: 'media',
    });
    const org = '01900000-0000-7000-8000-000000000003';
    const key = `${org}/01900000-0000-7000-8000-000000000002/u-${'b'.repeat(32)}`;
    const signed = store.presignPut?.(org, key, { bytes: 4321, expiresInSeconds: 3600 });
    expect(signed?.headers).toEqual({ 'content-length': '4321' });
    const u = new URL(signed?.url ?? '');
    expect(u.host).toBe('acct.r2.cloudflarestorage.com');
    expect(u.pathname).toBe(`/media/${key}`);
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(() =>
      store.presignPut?.(org, `01900000-0000-7000-8000-000000000009/x/u-${'b'.repeat(32)}`, {
        bytes: 1,
        expiresInSeconds: 1,
      }),
    ).toThrow();
  });
});
