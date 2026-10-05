import { type KeyObject, verify, X509Certificate } from 'node:crypto';
import { DeliveryEvent } from '../delivery.ts';
import { SES_TAG_MESSAGE } from './ses.ts';
import { type Fetch, fail, type ProviderWebhookAdapter, WebhookVerificationError } from './types.ts';

/**
 * Amazon SNS HTTPS deliveries (M3.5b), verified the way AWS documents it: the signing
 * certificate must come from an `sns.<region>.amazonaws.com` HTTPS URL, the signature (v1
 * SHA1withRSA or v2 SHA256withRSA) is checked over the canonical string of the message's fields,
 * the topic must be ours, and a message older than an hour is refused (replays). Subscription
 * confirmations are completed by visiting the SubscribeURL (same host rule). The SES event in
 * the message becomes delivery events for `recordDeliveryEventsCommand`, deduplicated there by
 * the SNS message id.
 */
export const SNS_REPLAY_TOLERANCE_S = 3600;

export interface SnsMessage {
  readonly Type: string;
  readonly MessageId: string;
  readonly TopicArn: string;
  readonly Message: string;
  readonly Timestamp: string;
  readonly SignatureVersion: string;
  readonly Signature: string;
  readonly SigningCertURL: string;
  readonly Subject?: string;
  readonly SubscribeURL?: string;
  readonly Token?: string;
}

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** An AWS SNS URL (certificates, SubscribeURL): HTTPS on an `sns.<region>.amazonaws.com` host. */
export function isSnsUrl(raw: string, kind: 'cert' | 'subscribe' = 'cert'): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (!SNS_HOST.test(url.hostname)) return false;
  return kind === 'cert' ? url.pathname.endsWith('.pem') : true;
}

/** The canonical string SNS signs (fields in this order, each as `name\nvalue\n`). */
export function snsStringToSign(m: SnsMessage): string {
  const fields =
    m.Type === 'Notification'
      ? [
          'Message',
          'MessageId',
          ...(m.Subject !== undefined ? ['Subject'] : []),
          'Timestamp',
          'TopicArn',
          'Type',
        ]
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.map((f) => `${f}\n${(m as unknown as Record<string, string>)[f] ?? ''}\n`).join('');
}

export type CertKey = (url: string) => Promise<KeyObject>;

/**
 * The public key of an SNS signing certificate, fetched once per URL and cached. The certificate
 * must be valid now and issued to `sns.amazonaws.com`.
 */
export function snsCertKeys(fetchFn: Fetch = fetch, now: () => Date = () => new Date()): CertKey {
  const cache = new Map<string, KeyObject>();
  return async (url) => {
    const hit = cache.get(url);
    if (hit) return hit;
    if (!isSnsUrl(url, 'cert')) throw new WebhookVerificationError('untrusted', 'certificate URL');
    const res = await fetchFn(url);
    if (!res.ok) throw new WebhookVerificationError('untrusted', `certificate HTTP ${res.status}`);
    const cert = new X509Certificate(await res.text());
    const t = now().getTime();
    if (t < Date.parse(cert.validFrom) || t > Date.parse(cert.validTo))
      throw new WebhookVerificationError('untrusted', 'certificate expired');
    if (!/CN=sns\.amazonaws\.com/.test(cert.subject))
      throw new WebhookVerificationError('untrusted', 'certificate subject');
    const key = cert.publicKey;
    cache.set(url, key);
    return key;
  };
}

/** Verify one SNS message (signature, certificate host, topic, age). Returns the parsed message. */
export async function verifySnsMessage(
  rawBody: string,
  opts: { certKey: CertKey; topicArns: readonly string[]; now?: Date },
): Promise<SnsMessage> {
  let m: SnsMessage;
  try {
    m = JSON.parse(rawBody) as SnsMessage;
  } catch {
    return fail('malformed', 'not JSON');
  }
  if (!m || typeof m !== 'object') return fail('malformed');
  for (const k of ['Type', 'MessageId', 'TopicArn', 'Timestamp', 'Signature', 'SigningCertURL'] as const)
    if (typeof m[k] !== 'string' || !m[k]) return fail('missing', k);
  if (typeof m.Message !== 'string') return fail('missing', 'Message');
  if (!['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(m.Type))
    return fail('malformed', 'type');
  if (m.SignatureVersion !== '1' && m.SignatureVersion !== '2') return fail('malformed', 'signature version');
  if (!isSnsUrl(m.SigningCertURL, 'cert')) return fail('untrusted', 'certificate URL');
  const key = await opts.certKey(m.SigningCertURL);
  const ok = verify(
    m.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256',
    Buffer.from(snsStringToSign(m), 'utf8'),
    key,
    Buffer.from(m.Signature, 'base64'),
  );
  if (!ok) return fail('invalid');
  // Only after the signature: which topic, and how old.
  if (!opts.topicArns.includes(m.TopicArn)) return fail('untrusted', 'topic');
  const at = Date.parse(m.Timestamp);
  if (!Number.isFinite(at)) return fail('malformed', 'timestamp');
  if (Math.abs((opts.now ?? new Date()).getTime() - at) > SNS_REPLAY_TOLERANCE_S * 1000)
    return fail('replayed');
  return m;
}

interface SesMail {
  messageId?: string;
  destination?: string[];
  tags?: Record<string, string[]>;
}
interface SesEvent {
  eventType?: string;
  notificationType?: string;
  mail?: SesMail;
  bounce?: {
    bounceType?: string;
    bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string; status?: string }>;
    timestamp?: string;
  };
  complaint?: {
    complainedRecipients?: Array<{ emailAddress?: string }>;
    complaintFeedbackType?: string;
    timestamp?: string;
  };
  delivery?: { recipients?: string[]; timestamp?: string };
}

/**
 * An SES event (event publishing `eventType`, or a feedback notification's `notificationType`)
 * as delivery events. Sends without our message tag (another system's mail) and event types we
 * don't act on (Send, Open, Click, DeliveryDelay…) produce none.
 */
export function sesEventToDeliveryEvents(
  eventId: string,
  message: string,
  fallbackAt: Date,
): DeliveryEvent[] {
  let e: SesEvent;
  try {
    e = JSON.parse(message) as SesEvent;
  } catch {
    return [];
  }
  const type = e.eventType ?? e.notificationType;
  const messageId = e.mail?.tags?.[SES_TAG_MESSAGE]?.[0];
  if (!messageId || !/^[0-9a-f-]{36}$/i.test(messageId)) return [];
  const base = { messageId, providerMessageId: e.mail?.messageId ?? null };
  const at = (s: string | undefined) => (s && Number.isFinite(Date.parse(s)) ? new Date(s) : fallbackAt);
  const out: unknown[] = [];
  if (type === 'Delivery') {
    const rcpts = e.delivery?.recipients?.length ? e.delivery.recipients : [null];
    rcpts.forEach((r, i) => {
      out.push({
        ...base,
        id: rcpts.length > 1 ? `${eventId}:${i}` : eventId,
        type: 'delivered',
        recipient: r,
        occurredAt: at(e.delivery?.timestamp),
      });
    });
  } else if (type === 'Bounce') {
    const hard = e.bounce?.bounceType === 'Permanent';
    const rcpts = e.bounce?.bouncedRecipients?.length ? e.bounce.bouncedRecipients : [{}];
    rcpts.forEach((r, i) => {
      out.push({
        ...base,
        id: rcpts.length > 1 ? `${eventId}:${i}` : eventId,
        type: 'bounced',
        bounceType: hard ? 'hard' : 'soft',
        recipient: r.emailAddress ?? null,
        detail: (r.diagnosticCode ?? r.status ?? e.bounce?.bounceType ?? null)?.slice(0, 500) ?? null,
        occurredAt: at(e.bounce?.timestamp),
      });
    });
  } else if (type === 'Complaint') {
    const rcpts = e.complaint?.complainedRecipients?.length ? e.complaint.complainedRecipients : [{}];
    rcpts.forEach((r, i) => {
      out.push({
        ...base,
        id: rcpts.length > 1 ? `${eventId}:${i}` : eventId,
        type: 'complained',
        recipient: r.emailAddress ?? null,
        detail: e.complaint?.complaintFeedbackType ?? 'complaint',
        occurredAt: at(e.complaint?.timestamp),
      });
    });
  }
  return out.map((x) => DeliveryEvent.parse(x));
}

export interface SesWebhookConfig {
  readonly topicArns: readonly string[];
  readonly certKey?: CertKey;
  /** Completes a subscription (GET the SubscribeURL); injected so tests never call AWS. */
  readonly confirm?: (subscribeUrl: string) => Promise<void>;
  readonly fetch?: Fetch;
  readonly now?: () => Date;
}

/** The SES → SNS webhook adapter (`POST /api/webhooks/email/ses`). */
export function sesWebhookAdapter(cfg: SesWebhookConfig): ProviderWebhookAdapter {
  const certKey = cfg.certKey ?? snsCertKeys(cfg.fetch ?? fetch);
  const confirm =
    cfg.confirm ??
    (async (url: string) => {
      const res = await (cfg.fetch ?? fetch)(url);
      if (!res.ok) throw new Error(`sns confirm: HTTP ${res.status}`);
    });
  return {
    name: 'ses',
    async verify(req) {
      const now = cfg.now?.() ?? new Date();
      const m = await verifySnsMessage(req.rawBody, { certKey, topicArns: cfg.topicArns, now });
      if (m.Type === 'SubscriptionConfirmation') {
        if (!m.SubscribeURL || !isSnsUrl(m.SubscribeURL, 'subscribe'))
          return fail('untrusted', 'SubscribeURL');
        await confirm(m.SubscribeURL);
        return { events: [], inbound: [], confirmed: true };
      }
      if (m.Type !== 'Notification') return { events: [], inbound: [] };
      return {
        events: sesEventToDeliveryEvents(`sns:${m.MessageId}`, m.Message, new Date(m.Timestamp)),
        inbound: [],
      };
    },
  };
}
