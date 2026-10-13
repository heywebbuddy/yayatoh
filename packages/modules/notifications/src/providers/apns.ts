import { createHash, createPrivateKey, createSign } from 'node:crypto';
import { connect as http2Connect } from 'node:http2';
import type { OutboundPush, PushSendResult, PushTransport } from '../transports.ts';

/**
 * The APNs adapter (M7.2c): Apple's HTTP/2 provider API with token-based (`.p8`) authentication.
 * Apple's account is the owner's (docs/owner-inbox.md); until it exists the dev mailbox stands in
 * and this code runs only against recorded responses (an injected `http2` client).
 *
 * - One ES256 JWT (`kid` = the key id, `iss` = the team id), kept for 50 minutes: Apple refuses a
 *   new token within 20 minutes of the last (429 `TooManyProviderTokenUpdates`) and one older
 *   than 60 minutes (403 `ExpiredProviderToken`).
 * - The topic is the app's bundle id; the host is chosen per token (a development build's token
 *   only works on the sandbox host, a store build's on production).
 * - `apns-collapse-id` carries the ticket's collapse id, so a newer push replaces an older one.
 * - What Apple reports about a token decides its fate: 410 `Unregistered` and 400 `BadDeviceToken`
 *   / `DeviceTokenNotForTopic` say the device is gone for this app (disable it); 429 and 5xx are
 *   retried later by the dispatcher with backoff; anything else is a refusal of this one message.
 */
export const APNS_PRODUCTION_ORIGIN = 'https://api.push.apple.com';
export const APNS_SANDBOX_ORIGIN = 'https://api.sandbox.push.apple.com';

export interface ApnsConfig {
  readonly keyId: string;
  readonly teamId: string;
  /** The `.p8` file's text (PKCS#8 PEM, an EC P-256 key). */
  readonly privateKey: string;
  /** The app's bundle id(s): the first is the default topic; a device's own id must be listed. */
  readonly bundleIds: readonly string[];
}

export interface ApnsRequest {
  readonly origin: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
}

export interface ApnsResponse {
  readonly status: number;
  /** Lower-cased header names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** One HTTP/2 request to APNs; a network failure rejects. Tests inject recorded answers. */
export type ApnsHttp2 = (req: ApnsRequest) => Promise<ApnsResponse>;

/** The `.p8` text as an env value may hold it: literal `\n` sequences become line breaks. */
export function normalizePem(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

/** The APNs settings from config names (`APNS_*`), or null when any is missing. */
export function apnsConfigFromEnv(env: Readonly<Record<string, string | undefined>>): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const privateKey = env.APNS_PRIVATE_KEY?.trim();
  const bundleIds = (env.APNS_BUNDLE_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!keyId || !teamId || !privateKey || bundleIds.length === 0) return null;
  return { keyId, teamId, privateKey: normalizePem(privateKey), bundleIds };
}

const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** The provider authentication token (ES256, raw r||s signature as JWS requires). */
export function apnsProviderToken(
  cfg: Pick<ApnsConfig, 'keyId' | 'teamId' | 'privateKey'>,
  now: Date,
): string {
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const claims = b64u(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now.getTime() / 1000) }));
  const signature = createSign('SHA256')
    .update(`${head}.${claims}`)
    .sign({ key: createPrivateKey(cfg.privateKey), dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64u(signature)}`;
}

/** A device token is the device's hex id (32 bytes today; Apple has said it may grow). */
export const APNS_TOKEN_RE = /^[0-9a-fA-F]{32,200}$/;

/** An `apns-id` (a canonical UUID) derived from our idempotency key, so a retry reuses it. */
export function apnsId(idempotencyKey: string): string {
  const h = createHash('sha256').update(idempotencyKey).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The notification body: the allowlisted title/body plus the in-app route; nothing else. */
export function apnsPayload(m: Pick<OutboundPush, 'title' | 'body' | 'path' | 'topic' | 'lang'>) {
  return {
    aps: {
      alert: { title: m.title, body: m.body },
      sound: 'default',
      ...(m.topic ? { 'thread-id': m.topic } : {}),
    },
    ...(m.path ? { path: m.path } : {}),
    ...(m.lang ? { lang: m.lang } : {}),
  };
}

export type ApnsOutcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'invalid_token' }
  | { readonly kind: 'refresh_token' }
  | { readonly kind: 'retry'; readonly retryAfterMs: number | null }
  | { readonly kind: 'rejected'; readonly reason: string };

/** What APNs' answer means (the `reason` is the JSON body's `reason`, empty on 200). */
export function classifyApnsResponse(
  status: number,
  reason: string,
  retryAfter?: string | null,
): ApnsOutcome {
  if (status === 200) return { kind: 'sent' };
  // The device is gone for this app: unregistered (410), a malformed token or one from the other
  // environment (400 BadDeviceToken), or one issued to another app (400 DeviceTokenNotForTopic).
  if (status === 410 || reason === 'Unregistered') return { kind: 'invalid_token' };
  if (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic') return { kind: 'invalid_token' };
  if (reason === 'ExpiredProviderToken') return { kind: 'refresh_token' };
  if (status === 429 || status >= 500) {
    const seconds = Number(retryAfter);
    return {
      kind: 'retry',
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : null,
    };
  }
  return { kind: 'rejected', reason: reason || `http_${status}` };
}

const PRIORITY = { high: '10', normal: '5', low: '5', 'very-low': '5' } as const;

/**
 * The adapter. `http2` defaults to a shared `node:http2` session per host; a dropped session is
 * replaced on the next send. Tokens are never logged: results carry the status and Apple's reason
 * only.
 */
export function apnsTransport(opts: {
  readonly config: ApnsConfig;
  readonly http2?: ApnsHttp2;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}): PushTransport {
  const { config } = opts;
  const send = opts.http2 ?? nodeHttp2();
  let cached: { token: string; at: number } | null = null;
  const providerToken = (force: boolean): string => {
    const now = opts.now?.() ?? new Date();
    if (!force && cached && now.getTime() - cached.at < 50 * 60_000) return cached.token;
    cached = { token: apnsProviderToken(config, now), at: now.getTime() };
    return cached.token;
  };
  return {
    name: 'apns',
    async send(m: OutboundPush): Promise<PushSendResult> {
      if (m.platform !== 'apns') throw new Error(`APNs adapter cannot send ${m.platform}`);
      if (!APNS_TOKEN_RE.test(m.token)) return { error: 'invalid_token' };
      const topic = m.appId && config.bundleIds.includes(m.appId) ? m.appId : (config.bundleIds[0] as string);
      const origin = m.environment === 'sandbox' ? APNS_SANDBOX_ORIGIN : APNS_PRODUCTION_ORIGIN;
      const now = opts.now?.() ?? new Date();
      const body = JSON.stringify(apnsPayload(m));
      const request = (force: boolean): Promise<ApnsResponse> =>
        send({
          origin,
          path: `/3/device/${m.token}`,
          headers: {
            authorization: `bearer ${providerToken(force)}`,
            'apns-topic': topic,
            'apns-push-type': 'alert',
            'apns-priority': PRIORITY[m.urgency ?? 'normal'],
            'apns-expiration': String(Math.floor(now.getTime() / 1000) + (m.ttlSeconds ?? 86_400)),
            'apns-id': apnsId(m.idempotencyKey),
            ...(m.topic ? { 'apns-collapse-id': m.topic.slice(0, 64) } : {}),
            'content-type': 'application/json',
          },
          body,
          timeoutMs: opts.timeoutMs ?? 10_000,
        });
      let res: ApnsResponse;
      try {
        res = await request(false);
      } catch {
        return { error: 'retry', retryAfterMs: null };
      }
      let outcome = classifyApnsResponse(res.status, reasonOf(res.body), res.headers['retry-after']);
      if (outcome.kind === 'refresh_token') {
        // Our token aged out (clock skew, a long-lived process): sign a fresh one and try once more.
        try {
          res = await request(true);
        } catch {
          return { error: 'retry', retryAfterMs: null };
        }
        outcome = classifyApnsResponse(res.status, reasonOf(res.body), res.headers['retry-after']);
        if (outcome.kind === 'refresh_token')
          return { error: 'retry', status: res.status, retryAfterMs: null };
      }
      switch (outcome.kind) {
        case 'sent':
          return { providerMessageId: (res.headers['apns-id'] ?? `apns-${res.status}`).slice(0, 200) };
        case 'invalid_token':
          return { error: 'invalid_token', status: res.status };
        case 'retry':
          return { error: 'retry', status: res.status, retryAfterMs: outcome.retryAfterMs };
        default:
          return { error: 'rejected', status: res.status, detail: outcome.reason };
      }
    },
  };
}

function reasonOf(body: string): string {
  try {
    const r = (JSON.parse(body) as { reason?: unknown }).reason;
    return typeof r === 'string' ? r.slice(0, 80) : '';
  } catch {
    return '';
  }
}

/** The default client: one `node:http2` session per origin, reused while it lives. */
function nodeHttp2(): ApnsHttp2 {
  const sessions = new Map<string, ReturnType<typeof http2Connect>>();
  const sessionFor = (origin: string) => {
    const open = sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const s = http2Connect(origin);
    s.on('error', () => sessions.delete(origin));
    s.on('close', () => sessions.delete(origin));
    s.on('goaway', () => sessions.delete(origin));
    // Do not keep the process alive for an idle connection.
    s.unref();
    sessions.set(origin, s);
    return s;
  };
  return (req) =>
    new Promise<ApnsResponse>((resolve, reject) => {
      const session = sessionFor(req.origin);
      const stream = session.request({ ':method': 'POST', ':path': req.path, ...req.headers });
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error('apns: timeout'));
      }, req.timeoutMs);
      let status = 0;
      let headers: Record<string, string> = {};
      const chunks: Buffer[] = [];
      stream.on('response', (h) => {
        status = Number(h[':status'] ?? 0);
        headers = Object.fromEntries(
          Object.entries(h)
            .filter(([k, v]) => !k.startsWith(':') && typeof v === 'string')
            .map(([k, v]) => [k.toLowerCase(), v as string]),
        );
      });
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        clearTimeout(timer);
        resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') });
      });
      stream.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      stream.end(req.body);
    });
}
