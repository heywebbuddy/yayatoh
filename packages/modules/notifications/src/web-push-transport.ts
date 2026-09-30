import { createHmac } from 'node:crypto';
import type { OutboundPush, PushSendResult, PushTransport, Transports } from './transports.ts';
import {
  b64url,
  buildWebPushPayload,
  classifyPushResponse,
  encryptPayload,
  isAllowedPushEndpoint,
  isVapidSubject,
  pushHeaders,
  type VapidKeys,
  vapidAuthorization,
  vapidPublicKeyOf,
} from './web-push.ts';

export interface VapidConfig {
  readonly keys: VapidKeys;
  /** `mailto:` or `https:` contact the push services can reach us at (RFC 8292 §2.1). */
  readonly subject: string;
  /** True when the keys were derived for development (never in production). */
  readonly dev: boolean;
}

export const DEFAULT_VAPID_SUBJECT = 'mailto:notifications@mail.yayatoh.com';

/** Development only: a stable key pair derived from APP_TOKEN_SECRET, so dev and CI need no setup. */
function devVapidKeys(secret: string): VapidKeys {
  for (let i = 0; i < 8; i++) {
    const d = createHmac('sha256', secret).update(`yayatoh dev vapid ${i}`).digest();
    try {
      const privateKey = b64url.encode(d);
      return { privateKey, publicKey: vapidPublicKeyOf(privateKey) };
    } catch {
      // Out of the curve's range (probability ~2^-32): try the next counter.
    }
  }
  throw new Error('web push: could not derive a dev VAPID key');
}

/**
 * The VAPID keys for this environment: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
 * (production: owner-generated, stored in Doppler; docs/owner-inbox.md). Development and CI derive
 * a stable pair from `APP_TOKEN_SECRET` when none is set. Production without keys: null (the
 * opt-in is not offered and push rows are never queued for browsers). A mismatched pair throws.
 */
export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT;
  if (!isVapidSubject(subject)) throw new Error('VAPID_SUBJECT must be a mailto: or https: URI');
  const pub = env.VAPID_PUBLIC_KEY?.trim();
  const priv = env.VAPID_PRIVATE_KEY?.trim();
  if (pub && priv) {
    if (vapidPublicKeyOf(priv) !== pub) throw new Error('VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY');
    return { keys: { publicKey: pub, privateKey: priv }, subject, dev: false };
  }
  if (pub || priv) throw new Error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
  if (env.VERCEL_ENV === 'production') return null;
  const secret = env.APP_TOKEN_SECRET;
  if (!secret) return null;
  return { keys: devVapidKeys(secret), subject, dev: true };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The web push adapter (RFC 8030 + 8291 + 8292): encrypts the allowlisted payload for the
 * subscription, signs a VAPID JWT for the push service's origin and POSTs it with TTL, Urgency
 * and Topic. Only known push services are contacted (or, in dev/CI, the fake push service on the
 * app's own origin): the endpoint comes from a browser, so anything else is refused.
 */
export function webPushTransport(opts: {
  readonly vapid: VapidConfig;
  readonly appOrigin: string;
  /** Dev/CI: the app origin whose `/api/dev/push-service/…` endpoints are allowed. */
  readonly fakeOrigin?: string | null;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}): PushTransport {
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  return {
    async send(m: OutboundPush): Promise<PushSendResult> {
      if (m.platform !== 'webpush') throw new Error(`web push adapter cannot send ${m.platform}`);
      if (!m.keys) return { error: 'rejected', detail: 'missing_keys' };
      if (!isAllowedPushEndpoint(m.token, { fakeOrigin: opts.fakeOrigin ?? null }))
        return { error: 'rejected', detail: 'endpoint_not_allowed' };
      const payload = buildWebPushPayload({
        title: m.title,
        body: m.body,
        url: m.url,
        appOrigin: opts.appOrigin,
        tag: m.topic ?? 'yayatoh',
        lang: m.lang ?? 'en',
        dir: m.dir ?? 'ltr',
      });
      const body = encryptPayload({
        payload: JSON.stringify(payload),
        p256dh: m.keys.p256dh,
        auth: m.keys.auth,
      });
      const now = opts.now?.() ?? new Date();
      const endpoint = new URL(m.token);
      const headers = pushHeaders({
        authorization: vapidAuthorization({
          audience: endpoint.origin,
          subject: opts.vapid.subject,
          keys: opts.vapid.keys,
          now,
        }),
        ttlSeconds: m.ttlSeconds ?? 86_400,
        urgency: m.urgency ?? 'normal',
        topic: m.topic ?? null,
        contentLength: body.length,
      });
      let res: Response;
      try {
        res = await doFetch(m.token, {
          method: 'POST',
          headers,
          body: new Uint8Array(body),
          redirect: 'error',
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
      } catch {
        return { error: 'retry', retryAfterMs: null };
      }
      const outcome = classifyPushResponse(res.status, res.headers, now);
      await res.body?.cancel().catch(() => undefined);
      switch (outcome.kind) {
        case 'sent':
          return { providerMessageId: (outcome.providerMessageId ?? `webpush-${res.status}`).slice(0, 200) };
        case 'expired':
          return { error: 'invalid_token', status: outcome.status };
        case 'retry':
          return { error: 'retry', status: outcome.status, retryAfterMs: outcome.retryAfterMs };
        default:
          return { error: 'rejected', status: outcome.status, detail: `http_${outcome.status}` };
      }
    },
  };
}

/** One push transport per platform (web push here; FCM/APNs keep their own adapters). */
export function routedPushTransport(
  byPlatform: Partial<Record<OutboundPush['platform'], PushTransport>>,
  fallback?: PushTransport,
): PushTransport {
  return {
    send(m) {
      const t = byPlatform[m.platform] ?? fallback;
      if (!t) throw new Error(`no push adapter for ${m.platform}`);
      return t.send(m);
    },
  };
}

/**
 * Route web push through the real adapter when VAPID keys exist (dev/CI derive them), leaving the
 * other channels as they are. Used by the worker and the dev drain.
 */
export function withWebPush(
  transports: Transports,
  opts: {
    readonly vapid: VapidConfig | null;
    readonly appOrigin: string;
    readonly fakeOrigin?: string | null;
  },
): Transports {
  if (!opts.vapid) return transports;
  return {
    ...transports,
    push: routedPushTransport(
      {
        webpush: webPushTransport({
          vapid: opts.vapid,
          appOrigin: opts.appOrigin,
          fakeOrigin: opts.fakeOrigin ?? null,
        }),
      },
      transports.push,
    ),
  };
}
