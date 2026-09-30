import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { z } from 'zod';

/**
 * Standard Web Push (M1.10e) with no provider account: RFC 8030 (the push protocol), RFC 8292
 * (VAPID: the application server identifies itself with an ES256-signed JWT) and RFC 8291
 * (message encryption: ECDH P-256 + HKDF + AES-128-GCM, `aes128gcm` content coding, RFC 8188).
 * Everything uses `node:crypto`; no push library.
 */

export const b64url = {
  encode: (buf: Uint8Array): string => Buffer.from(buf).toString('base64url'),
  decode: (s: string): Buffer => Buffer.from(s, 'base64url'),
};

const P256_PUBLIC_BYTES = 65;
const AUTH_SECRET_BYTES = 16;

export interface VapidKeys {
  /** Uncompressed P-256 point (65 bytes), base64url: the browser's `applicationServerKey`. */
  readonly publicKey: string;
  /** The private scalar (32 bytes), base64url. Never leaves the server; never in the repo. */
  readonly privateKey: string;
}

/** A fresh VAPID key pair (the dev script; the owner generates production keys the same way). */
export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url.encode(ecdh.getPublicKey()), privateKey: b64url.encode(ecdh.getPrivateKey()) };
}

/** The public key for a private scalar (validates the pair from the environment). */
export function vapidPublicKeyOf(privateKey: string): string {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(b64url.decode(privateKey));
  return b64url.encode(ecdh.getPublicKey());
}

function privateKeyObject(keys: VapidKeys) {
  const pub = b64url.decode(keys.publicKey);
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: b64url.encode(pub.subarray(1, 33)),
      y: b64url.encode(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
}

function publicKeyObject(publicKey: string) {
  const pub = b64url.decode(publicKey);
  if (pub.length !== P256_PUBLIC_BYTES || pub[0] !== 4) throw new Error('web push: bad P-256 public key');
  return createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64url.encode(pub.subarray(1, 33)),
      y: b64url.encode(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
}

/** RFC 8292 §2: at most 24 hours; we sign for 12. */
export const VAPID_TOKEN_TTL_S = 12 * 3600;

/** A VAPID subject must be a `mailto:` or `https:` URI (RFC 8292 §2.1). */
export function isVapidSubject(s: string): boolean {
  return /^mailto:[^@\s]+@[^@\s]+$/.test(s) || /^https:\/\/[^\s]+$/.test(s);
}

/** The ES256 JWT for one push service origin (`aud`), expiring in 12 hours (RFC 8292 §2). */
export function vapidJwt(opts: {
  readonly audience: string;
  readonly subject: string;
  readonly keys: VapidKeys;
  readonly now?: Date;
}): string {
  if (!isVapidSubject(opts.subject)) throw new Error('web push: VAPID subject must be mailto: or https:');
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const header = b64url.encode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url.encode(
    Buffer.from(JSON.stringify({ aud: opts.audience, exp: now + VAPID_TOKEN_TTL_S, sub: opts.subject })),
  );
  const input = `${header}.${claims}`;
  // JOSE wants the raw r||s form (64 bytes), not DER.
  const sig = sign('sha256', Buffer.from(input), {
    key: privateKeyObject(opts.keys),
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${b64url.encode(sig)}`;
}

/** The `Authorization` header value (RFC 8292 §3): `vapid t=<jwt>, k=<public key>`. */
export function vapidAuthorization(opts: Parameters<typeof vapidJwt>[0]): string {
  return `vapid t=${vapidJwt(opts)}, k=${opts.keys.publicKey}`;
}

/**
 * The push service's side (the fake push service, tests): check a `vapid` Authorization header
 * against the expected public key and audience. Returns the claims, or null.
 */
export function verifyVapidAuthorization(
  header: string | null,
  expect: { readonly publicKey: string; readonly audience: string; readonly now?: Date },
): { aud: string; exp: number; sub: string } | null {
  const m = /^vapid t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(
    header ?? '',
  );
  if (!m?.[1] || !m[2]) return null;
  const k = b64url.decode(m[2]);
  const want = b64url.decode(expect.publicKey);
  if (k.length !== want.length || !timingSafeEqual(k, want)) return null;
  const [h, c, s] = m[1].split('.') as [string, string, string];
  try {
    const head = JSON.parse(b64url.decode(h).toString('utf8'));
    if (head.alg !== 'ES256') return null;
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${c}`),
      { key: publicKeyObject(m[2]), dsaEncoding: 'ieee-p1363' },
      b64url.decode(s),
    );
    if (!ok) return null;
    const claims = JSON.parse(b64url.decode(c).toString('utf8'));
    const now = Math.floor((expect.now ?? new Date()).getTime() / 1000);
    if (claims.aud !== expect.audience || typeof claims.exp !== 'number') return null;
    if (claims.exp <= now || claims.exp > now + 24 * 3600) return null;
    if (typeof claims.sub !== 'string' || !isVapidSubject(claims.sub)) return null;
    return claims;
  } catch {
    return null;
  }
}

const hmac = (key: Uint8Array, data: Uint8Array) => createHmac('sha256', key).update(data).digest();
const info = (type: string) => Buffer.concat([Buffer.from(`Content-Encoding: ${type}\0`, 'utf8')]);

/** The CEK and nonce for one message (RFC 8291 §3.3–3.4, RFC 8188 §2.2–2.3). */
function derive(opts: {
  ecdhSecret: Uint8Array;
  authSecret: Uint8Array;
  uaPublic: Uint8Array;
  asPublic: Uint8Array;
  salt: Uint8Array;
}) {
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), opts.uaPublic, opts.asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', opts.ecdhSecret, opts.authSecret, keyInfo, 32));
  const prk = hmac(opts.salt, ikm);
  const cek = hmac(prk, Buffer.concat([info('aes128gcm'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([info('nonce'), Buffer.from([1])])).subarray(0, 12);
  return { ikm, prk, cek, nonce };
}

/** The record size we declare: one record carries the whole message (≤ 4096 bytes, RFC 8291 §4). */
export const RECORD_SIZE = 4096;
/** Header (16 salt + 4 rs + 1 idlen + 65 keyid) + padding delimiter + GCM tag. */
const OVERHEAD = 16 + 4 + 1 + P256_PUBLIC_BYTES + 1 + 16;
/** The largest plaintext one message may carry (push services must accept 4096-byte bodies). */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - OVERHEAD;

/**
 * Encrypt a payload for one subscription (RFC 8291). `uaPublic` is the subscription's `p256dh`
 * and `authSecret` its `auth`. `salt` and the application server's ephemeral key pair are random
 * unless given (test vectors only).
 */
export function encryptPayload(opts: {
  readonly payload: Uint8Array | string;
  readonly p256dh: string;
  readonly auth: string;
  readonly salt?: Uint8Array;
  /** Ephemeral application-server private key (base64url), for RFC 8291 test vectors. */
  readonly asPrivateKey?: string;
}): Buffer {
  const uaPublic = b64url.decode(opts.p256dh);
  const authSecret = b64url.decode(opts.auth);
  if (uaPublic.length !== P256_PUBLIC_BYTES || uaPublic[0] !== 4) throw new Error('web push: bad p256dh');
  if (authSecret.length !== AUTH_SECRET_BYTES) throw new Error('web push: bad auth secret');
  const plaintext =
    typeof opts.payload === 'string' ? Buffer.from(opts.payload, 'utf8') : Buffer.from(opts.payload);
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('web push: payload too large');
  const ecdh = createECDH('prime256v1');
  if (opts.asPrivateKey) ecdh.setPrivateKey(b64url.decode(opts.asPrivateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ? Buffer.from(opts.salt) : randomBytes(16);
  if (salt.length !== 16) throw new Error('web push: salt must be 16 bytes');
  const { cek, nonce } = derive({ ecdhSecret, authSecret, uaPublic, asPublic, salt });
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // A single, last record: the padding delimiter is 0x02 (RFC 8188 §2).
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/**
 * Decrypt an `aes128gcm` body as the browser would (the fake push service and tests). Takes the
 * subscription's private key and auth secret; throws on anything malformed or tampered with.
 */
export function decryptPayload(opts: {
  readonly body: Uint8Array;
  /** The user agent's P-256 private scalar, base64url. */
  readonly uaPrivateKey: string;
  readonly auth: string;
}): Buffer {
  const body = Buffer.from(opts.body);
  if (body.length < 21) throw new Error('web push: truncated body');
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const records = body.subarray(21 + idlen);
  if (idlen !== P256_PUBLIC_BYTES || rs < 18 || records.length > rs || records.length < 17)
    throw new Error('web push: unsupported body');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(b64url.decode(opts.uaPrivateKey));
  const uaPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(asPublic);
  const { cek, nonce } = derive({
    ecdhSecret,
    authSecret: b64url.decode(opts.auth),
    uaPublic,
    asPublic,
    salt,
  });
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(records.subarray(records.length - 16));
  const padded = Buffer.concat([decipher.update(records.subarray(0, records.length - 16)), decipher.final()]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (end < 0 || padded[end] !== 2) throw new Error('web push: bad padding delimiter');
  return padded.subarray(0, end);
}

/** Internal: intermediate values for the RFC 8291 Appendix A vector test. */
export const _derive = derive;

export const URGENCIES = ['very-low', 'low', 'normal', 'high'] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * A `Topic` (RFC 8030 §5.4): at most 32 base64url characters. The push service replaces an
 * undelivered message with the same topic, so a retried send never shows twice.
 */
export function pushTopic(messageId: string): string {
  return createHash('sha256').update(messageId).digest('base64url').slice(0, 32);
}

/** The request headers for one push (RFC 8030 §5, RFC 8291 §4, RFC 8292 §3). */
export function pushHeaders(opts: {
  readonly authorization: string;
  readonly ttlSeconds: number;
  readonly urgency: Urgency;
  readonly topic?: string | null;
  readonly contentLength: number;
}): Record<string, string> {
  const ttl = Math.max(0, Math.min(Math.floor(opts.ttlSeconds), 28 * 86400));
  if (opts.topic != null && !/^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) throw new Error('web push: bad topic');
  return {
    Authorization: opts.authorization,
    TTL: String(ttl),
    Urgency: opts.urgency,
    ...(opts.topic ? { Topic: opts.topic } : {}),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(opts.contentLength),
  };
}

export type PushOutcome =
  | { readonly kind: 'sent'; readonly providerMessageId: string | null }
  /** 404/410: the subscription is gone; prune it. */
  | { readonly kind: 'expired'; readonly status: number }
  /** 429, 5xx, network: try again later (after `retryAfterMs` when the service said so). */
  | { readonly kind: 'retry'; readonly status: number; readonly retryAfterMs: number | null }
  /** 400, 401, 403, 413…: this message will never be accepted as sent; don't retry it. */
  | { readonly kind: 'rejected'; readonly status: number };

/** Parse `Retry-After` (seconds or an HTTP date) into milliseconds from `now`, capped at a day. */
export function retryAfterMs(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const v = value.trim();
  const ms = /^\d+$/.test(v) ? Number(v) * 1000 : Date.parse(v) - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), 86_400_000);
}

/** What a push service's response means for this subscription (RFC 8030 §5, §8.3). */
export function classifyPushResponse(
  status: number,
  headers: { get(name: string): string | null },
  now = new Date(),
): PushOutcome {
  if (status === 201 || status === 202 || status === 200)
    return { kind: 'sent', providerMessageId: headers.get('location') };
  if (status === 404 || status === 410) return { kind: 'expired', status };
  if (status === 429 || status >= 500)
    return { kind: 'retry', status, retryAfterMs: retryAfterMs(headers.get('retry-after'), now) };
  return { kind: 'rejected', status };
}

/**
 * Push services browsers subscribe with. Endpoints come from the browser, so the server only ever
 * POSTs to these hosts (no SSRF through a crafted "subscription").
 */
export const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
] as const;

/** The dev/CI fake push service path (dev auth only; see apps/web `/api/dev/push-service`). */
export const FAKE_PUSH_PATH = '/api/dev/push-service/';

/**
 * Whether the server may send to this endpoint: https on a known push service, or (dev/CI only,
 * when `fakeOrigin` is given) the fake push service on the app's own origin.
 */
export function isAllowedPushEndpoint(
  endpoint: string,
  opts: { readonly fakeOrigin?: string | null } = {},
): boolean {
  if (endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (opts.fakeOrigin && url.origin === new URL(opts.fakeOrigin).origin)
    return (
      url.pathname.startsWith(FAKE_PUSH_PATH) &&
      /^[A-Za-z0-9_-]{8,64}$/.test(url.pathname.slice(FAKE_PUSH_PATH.length))
    );
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return false;
  return PUSH_SERVICE_HOSTS.some((h) => h.test(url.hostname));
}

/** The browser's subscription (`PushSubscription.toJSON()`), validated. */
export const WebPushSubscription = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{21,24}={0,2}$/),
  }),
});
export type WebPushSubscription = z.infer<typeof WebPushSubscription>;

/** Normalise the keys (strip padding) and check they decode to a P-256 point and a 16-byte secret. */
export function normalizeSubscriptionKeys(keys: {
  p256dh: string;
  auth: string;
}): { p256dh: string; auth: string } | null {
  const p = keys.p256dh.replace(/=+$/, '');
  const a = keys.auth.replace(/=+$/, '');
  const pub = b64url.decode(p);
  if (pub.length !== P256_PUBLIC_BYTES || pub[0] !== 4 || b64url.decode(a).length !== AUTH_SECRET_BYTES)
    return null;
  try {
    publicKeyObject(p);
  } catch {
    return null;
  }
  return { p256dh: p, auth: a };
}

/**
 * What a push notification carries, and nothing else (allowlist): a title, a short body and a link
 * on our own origin. No recipient names, emails, ids or tokens beyond what the text shows.
 */
export const WebPushPayload = z
  .object({
    title: z.string().min(1).max(120),
    body: z.string().max(600),
    url: z.string().max(1024).nullable(),
    tag: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    lang: z.string().max(10),
    dir: z.enum(['ltr', 'rtl']),
  })
  .strict();
export type WebPushPayload = z.infer<typeof WebPushPayload>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Build the allowlisted payload; a link off our origin is dropped. */
export function buildWebPushPayload(input: {
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly appOrigin: string;
  readonly tag: string;
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
}): WebPushPayload {
  let url: string | null = null;
  if (input.url) {
    try {
      const u = new URL(input.url, input.appOrigin);
      if (u.origin === new URL(input.appOrigin).origin) url = u.toString();
    } catch {
      url = null;
    }
  }
  return WebPushPayload.parse({
    title: clip(input.title.trim() || '…', 120),
    body: clip(input.body.trim(), 600),
    url: url && url.length <= 1024 ? url : null,
    tag: input.tag,
    lang: input.lang,
    dir: input.dir,
  });
}
