import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 (the SES v2 API), with `node:crypto` only. Pure: the clock is an input,
 * so the published AWS test vector reproduces exactly (tests/providers.test.ts).
 */
export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string | null;
}

export interface SignInput {
  readonly method: string;
  readonly url: string;
  readonly region: string;
  readonly service: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly credentials: AwsCredentials;
  readonly now: Date;
}

const sha256 = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding as SigV4 wants it (unreserved characters kept). */
const encode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '');
}

/** The signed headers to send (`authorization`, `x-amz-date`, `host`, and any given). */
export function signAwsRequest(input: SignInput): Record<string, string> {
  const url = new URL(input.url);
  const date = amzDate(input.now);
  const day = date.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v.trim();
  headers.host = url.host;
  headers['x-amz-date'] = date;
  if (input.credentials.sessionToken) headers['x-amz-security-token'] = input.credentials.sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${(headers[n] ?? '').replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...url.searchParams]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = url.pathname
    .split('/')
    .map((seg) => encode(decodeURIComponent(seg)))
    .join('/');
  const canonical = [
    input.method.toUpperCase(),
    path || '/',
    query,
    canonicalHeaders,
    signedHeaders,
    sha256(input.body ?? ''),
  ].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, day), input.region), input.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
