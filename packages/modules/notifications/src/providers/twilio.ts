import { createHash, createHmac } from 'node:crypto';
import { DeliveryEvent } from '../delivery.ts';
import type { OutboundSms } from '../transports.ts';
import { parseKeyword } from './keywords.ts';
import {
  E164_RE,
  type Fetch,
  fail,
  type InboundKeyword,
  type Keyword,
  ProviderRejection,
  type ProviderWebhookAdapter,
  safeEqual,
} from './types.ts';

/**
 * Twilio Programmable Messaging (M3.5b), 10DLC-ready: every send goes through a Messaging
 * Service (the org's own when it has a registered campaign, else the platform's), with a status
 * callback that carries our message id. Callbacks and inbound messages are verified with
 * `X-Twilio-Signature` (HMAC-SHA1 of the URL and the sorted form fields of the raw body).
 */
export interface TwilioConfig {
  readonly accountSid: string;
  /** API key SID and secret (or the account SID and auth token) for the REST API. */
  readonly apiKeySid: string;
  readonly apiKeySecret: string;
  /** The auth token signs webhooks. */
  readonly authToken: string;
  /** The platform's Messaging Service (`TWILIO_MESSAGING_SERVICE_SID`). */
  readonly messagingServiceSid: string;
  /** Public origin for callbacks (`https://app.yayatoh.com`). */
  readonly callbackOrigin: string;
  readonly fetch?: Fetch;
}

export const TWILIO_SIGNATURE_HEADER = 'x-twilio-signature';
export const TWILIO_STATUS_PATH = '/api/webhooks/sms/twilio';
export const TWILIO_INBOUND_PATH = '/api/webhooks/sms/twilio/inbound';

/** Twilio's signature: base64 HMAC-SHA1 over the URL followed by each sorted `key` + `value`. */
export function twilioSignature(
  authToken: string,
  url: string,
  params: ReadonlyArray<[string, string]>,
): string {
  const data = [...params]
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .reduce((acc, [k, v]) => acc + k + v, url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/**
 * Verify a Twilio webhook on its raw body. Form posts: the signature covers the URL and fields.
 * JSON posts: the URL carries `bodySHA256` (the hex SHA-256 of the raw body) and the signature
 * covers the URL alone. Returns the form fields (empty for JSON).
 */
export function verifyTwilioRequest(
  authToken: string,
  req: { rawBody: string; headers: Headers; url: string },
): URLSearchParams {
  const signature = req.headers.get(TWILIO_SIGNATURE_HEADER);
  if (!signature) return fail('missing', 'X-Twilio-Signature');
  const url = new URL(req.url);
  const bodyHash = url.searchParams.get('bodySHA256');
  if (bodyHash !== null) {
    const expected = twilioSignature(authToken, req.url, []);
    if (!safeEqual(signature, expected)) return fail('invalid');
    const actual = createHash('sha256').update(req.rawBody, 'utf8').digest('hex');
    if (!safeEqual(bodyHash.toLowerCase(), actual)) return fail('invalid', 'body hash');
    return new URLSearchParams();
  }
  const params = new URLSearchParams(req.rawBody);
  const expected = twilioSignature(authToken, req.url, [...params]);
  if (!safeEqual(signature, expected)) return fail('invalid');
  return params;
}

/** Error codes that mean the number can't receive texts (suppress; try the next channel). */
export const TWILIO_HARD_ERRORS = new Set(['21211', '21614', '30004', '30005', '30006', '21610']);
/**
 * Errors about our sender or content (10DLC/toll-free registration, carrier filtering), not the
 * number: no delivery event (the address is not at fault); they count as provider errors.
 */
export const TWILIO_SENDER_ERRORS = new Set(['30007', '30032', '30033', '30034', '30035', '30036']);

/** A status callback as delivery events (none for in-flight states or sender-side errors). */
export function twilioStatusToEvents(params: URLSearchParams, messageId: string | null): DeliveryEvent[] {
  const sid = params.get('MessageSid') ?? params.get('SmsSid');
  const status = params.get('MessageStatus') ?? params.get('SmsStatus');
  if (!sid || !status || !messageId) return [];
  const code = params.get('ErrorCode') || null;
  const base = {
    id: `${sid}:${status}`,
    messageId,
    providerMessageId: sid,
    recipient: null,
    occurredAt: new Date(),
  };
  if (status === 'delivered') return [DeliveryEvent.parse({ ...base, type: 'delivered' })];
  if (status !== 'undelivered' && status !== 'failed') return [];
  if (code && TWILIO_SENDER_ERRORS.has(code)) return [];
  return [
    DeliveryEvent.parse({
      ...base,
      type: 'bounced',
      bounceType: code && TWILIO_HARD_ERRORS.has(code) ? 'hard' : 'soft',
      detail: `twilio ${status}${code ? ` ${code}` : ''}`,
    }),
  ];
}

/** An inbound text as a keyword (STOP/START/HELP), or null for anything else. */
export function twilioInboundKeyword(params: URLSearchParams, now = new Date()): InboundKeyword | null {
  const sid = params.get('MessageSid') ?? params.get('SmsSid');
  const from = params.get('From') ?? '';
  if (!sid || !E164_RE.test(from)) return null;
  const optOut = params.get('OptOutType')?.toLowerCase();
  const keyword: Keyword | null =
    optOut === 'stop' || optOut === 'start' || optOut === 'help' ? optOut : parseKeyword(params.get('Body'));
  if (!keyword) return null;
  return {
    id: sid,
    channel: 'sms',
    keyword,
    from,
    senderRef: params.get('MessagingServiceSid') ?? params.get('To'),
    receivedAt: now,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Status callbacks (`…/sms/twilio?m=<message id>`) and inbound messages (`…/inbound`). */
export function twilioWebhookAdapter(
  cfg: Pick<TwilioConfig, 'authToken'> & { now?: () => Date },
): ProviderWebhookAdapter {
  return {
    name: 'twilio',
    async verify(req) {
      const params = verifyTwilioRequest(cfg.authToken, req);
      const url = new URL(req.url);
      if (url.pathname.endsWith('/inbound')) {
        const k = twilioInboundKeyword(params, cfg.now?.() ?? new Date());
        return { events: [], inbound: k ? [k] : [] };
      }
      const m = url.searchParams.get('m');
      return { events: twilioStatusToEvents(params, m && UUID.test(m) ? m : null), inbound: [] };
    },
  };
}

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

/** The Twilio SMS adapter behind `SmsTransport`. */
export function twilioSmsTransport(cfg: TwilioConfig) {
  return {
    name: 'twilio' as const,
    async send(m: OutboundSms) {
      const form = new URLSearchParams({
        To: m.to,
        Body: m.body,
        MessagingServiceSid: m.sender?.messagingServiceSid ?? cfg.messagingServiceSid,
        StatusCallback: `${cfg.callbackOrigin}${TWILIO_STATUS_PATH}?m=${encodeURIComponent(m.idempotencyKey)}`,
      });
      const res = await (cfg.fetch ?? fetch)(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: basic(cfg.apiKeySid, cfg.apiKeySecret),
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number };
      if (res.ok && json.sid) return { providerMessageId: json.sid, provider: 'twilio' as const };
      const code = json.code ? String(json.code) : null;
      if (res.status === 429 || res.status >= 500) throw new Error(`twilio: HTTP ${res.status}`);
      if (code === '21610') throw new ProviderRejection('opted_out', code);
      if (code === '21211' || code === '21614') throw new ProviderRejection('invalid_address', code);
      throw new ProviderRejection('rejected', code ?? `HTTP ${res.status}`);
    },
  };
}

/** 10DLC campaign states as the org sees them. */
export const CAMPAIGN_STATUSES = ['not_registered', 'pending', 'verified', 'failed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** A dedicated sender's registration status (10DLC for Twilio). */
export interface SenderStatusPort {
  readonly name: 'twilio' | 'fake';
  campaignStatus(messagingServiceSid: string): Promise<CampaignStatus>;
}

const campaignOf = (s: unknown): CampaignStatus => {
  const v = String(s ?? '').toUpperCase();
  if (v === 'VERIFIED') return 'verified';
  if (v === 'FAILED') return 'failed';
  if (v === 'PENDING' || v === 'IN_PROGRESS') return 'pending';
  return 'not_registered';
};

/** Twilio's US A2P compliance for a Messaging Service (the campaign's review state). */
export function twilioSenderStatus(
  cfg: Pick<TwilioConfig, 'apiKeySid' | 'apiKeySecret' | 'fetch'>,
): SenderStatusPort {
  return {
    name: 'twilio',
    async campaignStatus(sid) {
      const res = await (cfg.fetch ?? fetch)(
        `https://messaging.twilio.com/v1/Services/${encodeURIComponent(sid)}/Compliance/Usa2p`,
        { headers: { authorization: basic(cfg.apiKeySid, cfg.apiKeySecret) } },
      );
      if (res.status === 404) return 'not_registered';
      if (!res.ok) throw new Error(`twilio compliance: HTTP ${res.status}`);
      const json = (await res.json()) as { compliance?: Array<{ campaign_status?: string }> };
      const states = (json.compliance ?? []).map((c) => campaignOf(c.campaign_status));
      if (states.includes('verified')) return 'verified';
      if (states.includes('pending')) return 'pending';
      if (states.includes('failed')) return 'failed';
      return 'not_registered';
    },
  };
}

/** Development and CI: a service SID ending in `f` failed review, `e` is in review, others verified. */
export function fakeSenderStatus(): SenderStatusPort {
  return {
    name: 'fake',
    async campaignStatus(sid) {
      const last = sid.slice(-1).toLowerCase();
      return last === 'f' ? 'failed' : last === 'e' ? 'pending' : 'verified';
    },
  };
}

export const MESSAGING_SERVICE_SID = /^MG[0-9a-f]{32}$/;
