import { createSign } from 'node:crypto';
import type { OutboundPush, PushSendResult, PushTransport } from '../transports.ts';
import { normalizePem } from './apns.ts';
import type { Fetch } from './types.ts';

/**
 * The FCM adapter (M7.2c): Firebase Cloud Messaging's HTTP v1 API with a service account. Google's
 * project is the owner's (docs/owner-inbox.md); until it exists the dev mailbox stands in and this
 * code runs only against recorded responses (an injected `fetch`).
 *
 * - The service account signs an RS256 JWT that is exchanged at its token endpoint for a one-hour
 *   OAuth access token (scope `firebase.messaging`), kept until five minutes before it expires. A
 *   401 from the send endpoint fetches a fresh token once.
 * - The message carries the allowlisted title and body, the in-app route as `data.path`, and the
 *   ticket's collapse id as `collapse_key` and the notification `tag` (so a newer push replaces an
 *   older one on the lock screen). The same id goes in `apns-collapse-id` for iOS devices on FCM.
 * - What FCM reports decides a token's fate: `UNREGISTERED` (404), `SENDER_ID_MISMATCH` (403) and
 *   an `INVALID_ARGUMENT` about the token say the device is gone (disable it); 429 and 5xx are
 *   retried later by the dispatcher with backoff; anything else refuses this one message.
 */
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const FCM_DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const FCM_ORIGIN = 'https://fcm.googleapis.com';

export interface FcmServiceAccount {
  readonly projectId: string;
  readonly clientEmail: string;
  /** The service account's PKCS#8 PEM private key. */
  readonly privateKey: string;
  readonly tokenUri: string;
}

/**
 * The service account from `FCM_SERVICE_ACCOUNT_JSON` (the JSON key file's text, or its base64),
 * or null when it is missing or incomplete. The token endpoint must be Google's own `https:` one.
 */
export function fcmConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): FcmServiceAccount | null {
  const raw = env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const j = JSON.parse(text) as Record<string, unknown>;
    const projectId = typeof j.project_id === 'string' ? j.project_id : '';
    const clientEmail = typeof j.client_email === 'string' ? j.client_email : '';
    const privateKey = typeof j.private_key === 'string' ? normalizePem(j.private_key) : '';
    const tokenUri = typeof j.token_uri === 'string' && j.token_uri ? j.token_uri : FCM_DEFAULT_TOKEN_URI;
    if (!/^[a-z][a-z0-9-]{3,60}$/.test(projectId) || !clientEmail || !privateKey) return null;
    if (!tokenUri.startsWith('https://')) return null;
    return { projectId, clientEmail, privateKey, tokenUri };
  } catch {
    return null;
  }
}

const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** The service account's signed assertion for the token endpoint. */
export function fcmAssertion(account: FcmServiceAccount, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(
    JSON.stringify({
      iss: account.clientEmail,
      scope: FCM_SCOPE,
      aud: account.tokenUri,
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(account.privateKey);
  return `${head}.${claims}.${b64u(signature)}`;
}

/** The v1 message for one device (`data` values are strings by FCM's rule). */
export function fcmMessage(m: OutboundPush) {
  const collapse = m.topic ?? undefined;
  const high = m.urgency === 'high' || m.urgency === undefined;
  return {
    token: m.token,
    notification: { title: m.title, body: m.body },
    data: { ...(m.path ? { path: m.path } : {}), ...(m.lang ? { lang: m.lang } : {}) },
    android: {
      ...(collapse ? { collapse_key: collapse } : {}),
      priority: high ? 'HIGH' : 'NORMAL',
      ttl: `${m.ttlSeconds ?? 86_400}s`,
      notification: { ...(collapse ? { tag: collapse } : {}), sound: 'default' },
    },
    apns: {
      headers: {
        ...(collapse ? { 'apns-collapse-id': collapse.slice(0, 64) } : {}),
        'apns-priority': high ? '10' : '5',
      },
      payload: { aps: { sound: 'default', ...(collapse ? { 'thread-id': collapse } : {}) } },
    },
  };
}

export type FcmOutcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'invalid_token' }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'retry'; readonly retryAfterMs: number | null }
  | { readonly kind: 'rejected'; readonly reason: string };

interface FcmErrorBody {
  readonly error?: {
    readonly status?: string;
    readonly message?: string;
    readonly details?: ReadonlyArray<{
      readonly errorCode?: string;
      readonly fieldViolations?: ReadonlyArray<{ readonly field?: string }>;
    }>;
  };
}

/** What FCM's answer means (`body` is the parsed JSON error, or empty). */
export function classifyFcmResponse(
  status: number,
  body: FcmErrorBody,
  retryAfter?: string | null,
): FcmOutcome {
  if (status === 200) return { kind: 'sent' };
  const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? '';
  if (status === 404 || code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH')
    return { kind: 'invalid_token' };
  if (code === 'INVALID_ARGUMENT' || status === 400) {
    // INVALID_ARGUMENT names the token field when the device token itself is malformed.
    const aboutToken = body.error?.details?.some((d) =>
      d.fieldViolations?.some((f) => f.field?.endsWith('token')),
    );
    return aboutToken ? { kind: 'invalid_token' } : { kind: 'rejected', reason: 'invalid_argument' };
  }
  if (status === 401 || code === 'UNAUTHENTICATED') return { kind: 'unauthenticated' };
  if (status === 429 || status >= 500 || code === 'QUOTA_EXCEEDED' || code === 'UNAVAILABLE') {
    const seconds = Number(retryAfter);
    return {
      kind: 'retry',
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : null,
    };
  }
  return { kind: 'rejected', reason: (code || `http_${status}`).slice(0, 60) };
}

const parseJson = (
  text: string,
): FcmErrorBody & { name?: string; access_token?: string; expires_in?: number } => {
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
};

export function fcmTransport(opts: {
  readonly account: FcmServiceAccount;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}): PushTransport {
  const { account } = opts;
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const timeout = () => AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  let access: { token: string; expiresAt: number } | null = null;

  /** The access token, fetched when missing or about to expire. `null`: the token endpoint failed. */
  async function accessToken(
    force: boolean,
  ): Promise<{ token: string } | { error: 'retry' | 'rejected'; status?: number }> {
    const now = opts.now?.() ?? new Date();
    if (!force && access && access.expiresAt - 300_000 > now.getTime()) return { token: access.token };
    let res: Response;
    try {
      res = await doFetch(account.tokenUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: fcmAssertion(account, now),
        }).toString(),
        redirect: 'error',
        signal: timeout(),
      });
    } catch {
      return { error: 'retry' };
    }
    const j = parseJson(await res.text().catch(() => ''));
    if (res.status !== 200 || typeof j.access_token !== 'string')
      // A refused service account is a configuration problem (never the device's fault).
      return res.status >= 500 || res.status === 429
        ? { error: 'retry', status: res.status }
        : { error: 'rejected', status: res.status };
    access = { token: j.access_token, expiresAt: now.getTime() + (j.expires_in ?? 3600) * 1000 };
    return { token: access.token };
  }

  return {
    name: 'fcm',
    async send(m: OutboundPush): Promise<PushSendResult> {
      if (m.platform !== 'fcm') throw new Error(`FCM adapter cannot send ${m.platform}`);
      const url = `${FCM_ORIGIN}/v1/projects/${account.projectId}/messages:send`;
      const payload = JSON.stringify({ message: fcmMessage(m) });
      const attempt = async (force: boolean) => {
        const auth = await accessToken(force);
        if ('error' in auth) return auth;
        try {
          const res = await doFetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
            body: payload,
            redirect: 'error',
            signal: timeout(),
          });
          return { res, text: await res.text().catch(() => '') };
        } catch {
          return { error: 'retry' as const };
        }
      };
      let r = await attempt(false);
      if ('res' in r && classifyFcmResponse(r.res.status, parseJson(r.text)).kind === 'unauthenticated') {
        access = null;
        r = await attempt(true);
      }
      if ('error' in r)
        return r.error === 'retry'
          ? { error: 'retry', ...(r.status ? { status: r.status } : {}), retryAfterMs: null }
          : { error: 'rejected', ...(r.status ? { status: r.status } : {}), detail: 'fcm_auth' };
      const body = parseJson(r.text);
      const outcome = classifyFcmResponse(r.res.status, body, r.res.headers.get('retry-after'));
      switch (outcome.kind) {
        case 'sent': {
          const id = typeof body.name === 'string' ? body.name.split('/').pop() : '';
          return { providerMessageId: (id || `fcm-${r.res.status}`).slice(0, 200) };
        }
        case 'invalid_token':
          return { error: 'invalid_token', status: r.res.status };
        case 'retry':
          return { error: 'retry', status: r.res.status, retryAfterMs: outcome.retryAfterMs };
        case 'unauthenticated':
          // Still refused with a fresh token: ours is the problem, not the device. Try later.
          return { error: 'retry', status: r.res.status, retryAfterMs: null };
        default:
          return { error: 'rejected', status: r.res.status, detail: outcome.reason };
      }
    },
  };
}
