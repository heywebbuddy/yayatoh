import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks signatures (https://www.standardwebhooks.com/, the scheme Svix uses; roadmap
 * §6.3): `webhook-id`, `webhook-timestamp` (unix seconds) and `webhook-signature`
 * (`v1,<base64 HMAC-SHA256(key, "<id>.<timestamp>.<body>")>`, space-separated during a secret
 * rotation). Secrets are `whsec_<base64 key>`. Receivers refuse a timestamp more than five minutes
 * away and dedupe on `webhook-id`.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const SECRET_PREFIX = 'whsec_';

/** A new endpoint secret (24 random bytes, as Svix makes them). */
export function newWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(24).toString('base64')}`;
}

function keyOf(secret: string): Buffer {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const key = Buffer.from(raw, 'base64');
  if (key.length < 16) throw new Error('webhook secret is too short');
  return key;
}

export function signWebhook(secret: string, msgId: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', keyOf(secret)).update(`${msgId}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
}

export interface SignedHeaders {
  readonly 'webhook-id': string;
  readonly 'webhook-timestamp': string;
  readonly 'webhook-signature': string;
}

/** The headers a delivery carries; more than one secret signs it (rotation overlap). */
export function webhookHeaders(
  secrets: readonly string[],
  msgId: string,
  timestamp: number,
  body: string,
): SignedHeaders {
  return {
    'webhook-id': msgId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': secrets.map((s) => signWebhook(s, msgId, timestamp, body)).join(' '),
  };
}

export class WebhookVerificationFailed extends Error {}

/** Verify a delivery (the platform's own check; the docs show the same steps for receivers). */
export function verifyWebhook(
  secret: string,
  headers: Readonly<Record<string, string | undefined>>,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sig = headers['webhook-signature'];
  if (!id || !ts || !sig) throw new WebhookVerificationFailed('missing headers');
  const t = Number(ts);
  if (!Number.isInteger(t) || Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS)
    throw new WebhookVerificationFailed('timestamp outside the tolerance');
  const expected = Buffer.from(signWebhook(secret, id, t, body).slice(3), 'base64');
  const ok = sig.split(' ').some((part) => {
    const [version, mac] = part.split(',');
    if (version !== 'v1' || !mac) return false;
    const given = Buffer.from(mac, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new WebhookVerificationFailed('no matching signature');
}
