import { createHash, createHmac } from 'node:crypto';
import { assertOrgKey, assetPrefix, type MediaStore } from './port.ts';

/**
 * Cloudflare R2 through its S3-compatible API, signed with AWS Signature Version 4 (region
 * `auto`). Configured by the owner's R2 account (owner inbox, M1.4e); never called in tests —
 * the signer is checked against AWS's published test vector and the adapter against a stub fetch.
 */
export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** Overrides `https://{accountId}.r2.cloudflarestorage.com` (tests, other S3 endpoints). */
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it (`/` kept in paths). */
export const uriEncode = (s: string, keepSlash: boolean) =>
  encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, keepSlash ? '/' : '%2F');

export interface SignInput {
  readonly method: string;
  readonly url: URL;
  /** Headers to sign (host is added from the URL). */
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadHash: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly service: string;
  readonly now: Date;
}

/** AWS Signature V4: returns the headers to send, including `authorization`. */
export function signV4(i: SignInput): Record<string, string> {
  const amzDate = i.now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: i.url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': i.payloadHash,
  };
  for (const [k, v] of Object.entries(i.headers)) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  const names = Object.keys(headers).sort();
  const query = [...i.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [
    i.method,
    uriEncode(decodeURIComponent(i.url.pathname), true),
    query,
    `${names.map((n) => `${n}:${headers[n]}`).join('\n')}\n`,
    names.join(';'),
    i.payloadHash,
  ].join('\n');
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), i.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return headers;
}

export function r2MediaStore(cfg: R2Config): MediaStore {
  const base = (cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`).replace(/\/$/, '');
  const doFetch = cfg.fetch ?? fetch;
  const now = cfg.now ?? (() => new Date());

  async function call(method: string, path: string, body?: Uint8Array, extra: Record<string, string> = {}) {
    const url = new URL(`${base}/${cfg.bucket}${path}`);
    const headers = signV4({
      method,
      url,
      headers: extra,
      payloadHash: sha256Hex(body ?? ''),
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: 'auto',
      service: 's3',
      now: now(),
    });
    delete headers.host;
    return doFetch(url, { method, headers, ...(body ? { body: Buffer.from(body) } : {}) });
  }
  const objectPath = (key: string) =>
    `/${key
      .split('/')
      .map((p) => uriEncode(p, false))
      .join('/')}`;

  return {
    kind: 'r2',
    async put(orgId, key, bytes, contentType) {
      assertOrgKey(orgId, key);
      const res = await call('PUT', objectPath(key), bytes, { 'content-type': contentType });
      if (!res.ok) throw new Error(`r2 put failed: ${res.status}`);
    },
    async get(orgId, key) {
      assertOrgKey(orgId, key);
      const res = await call('GET', objectPath(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`r2 get failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async deleteAsset(orgId, assetId) {
      const prefix = assetPrefix(orgId, assetId);
      let token: string | null = null;
      do {
        const q = new URLSearchParams({ 'list-type': '2', prefix });
        if (token) q.set('continuation-token', token);
        const res = await call('GET', `?${q.toString()}`);
        if (!res.ok) throw new Error(`r2 list failed: ${res.status}`);
        const xml = await res.text();
        const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1] as string);
        for (const key of keys) {
          if (!key.startsWith(prefix)) continue;
          const del = await call('DELETE', objectPath(key));
          if (!del.ok && del.status !== 404) throw new Error(`r2 delete failed: ${del.status}`);
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null)
          : null;
      } while (token);
    },
  };
}
