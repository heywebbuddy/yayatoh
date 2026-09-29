import { createHmac } from 'node:crypto';
import { DeliveryEvent } from '../delivery.ts';
import type { OutboundWhatsApp } from '../transports.ts';
import { parseKeyword } from './keywords.ts';
import {
  E164_RE,
  type Fetch,
  fail,
  type InboundKeyword,
  ProviderRejection,
  type ProviderWebhookAdapter,
  safeEqual,
  tagErrorProvider,
} from './types.ts';

/**
 * WhatsApp behind one port, two adapters (decision 2026-09-28, D16): the WhatsApp Cloud API for
 * new tenants, and the owner's gateway (`whatsapp.panitechnologies.com`) for existing flows
 * until they move. Business-initiated messages are approved templates: one per Meta category
 * (`utility` everywhere; marketing is blocked for +1 numbers by the policy gate), with the org's
 * name and the text as body parameters.
 */

/** Template names per Meta category (created and approved in the owner's WhatsApp Manager). */
export const WHATSAPP_TEMPLATES = {
  utility: 'yayatoh_update',
  marketing: 'yayatoh_news',
  authentication: 'yayatoh_code',
} as const;

/** Our locales as WhatsApp template language codes. */
export const WHATSAPP_LANGUAGES: Readonly<Record<string, string>> = {
  en: 'en_US',
  ar: 'ar',
  de: 'de',
  es: 'es',
  fr: 'fr',
  hi: 'hi',
  it: 'it',
  ja: 'ja',
  nl: 'nl',
  pt: 'pt_BR',
  ru: 'ru',
  'zh-CN': 'zh_CN',
  'zh-TW': 'zh_TW',
};

/** Template body parameters are limited in length; the text is cut on a character boundary. */
export const TEMPLATE_PARAM_MAX = 1024;
const cut = (s: string, n: number) => [...s].slice(0, n).join('');

export function whatsappTemplate(m: OutboundWhatsApp) {
  return {
    name: WHATSAPP_TEMPLATES[m.category],
    language: { code: WHATSAPP_LANGUAGES[m.locale ?? 'en'] ?? 'en_US' },
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: cut(m.orgName ?? 'Yayatoh', 60) },
          { type: 'text', text: cut(m.body, TEMPLATE_PARAM_MAX) },
        ],
      },
    ],
  };
}

export interface WhatsAppCloudConfig {
  /** A system-user token of the platform's Meta app (`WHATSAPP_CLOUD_ACCESS_TOKEN`). */
  readonly accessToken: string;
  /** The platform's phone number id, used when the org has none of its own. */
  readonly phoneNumberId: string;
  /** Signs webhooks (`X-Hub-Signature-256`). */
  readonly appSecret: string;
  /** Answers Meta's subscription check (`hub.verify_token`). */
  readonly verifyToken: string;
  readonly graphVersion?: string;
  readonly fetch?: Fetch;
}

export const META_SIGNATURE_HEADER = 'x-hub-signature-256';

/** Cloud API errors that mean the number can't get WhatsApp messages (try the next channel). */
export const CLOUD_NOT_ON_WHATSAPP = new Set(['131026']);
/** Errors about us (templates, account, payment, limits), not the number: no delivery event. */
const cloudSenderSide = (code: string) =>
  code.startsWith('132') ||
  ['131031', '131042', '131045', '131047', '131049', '130472', '131056', '130429'].includes(code);
const CLOUD_RETRY = new Set(['4', '80007', '130429', '131056', '131000', '2', '1']);

/** The Cloud API adapter behind `WhatsAppTransport`. */
export function whatsappCloudTransport(cfg: WhatsAppCloudConfig) {
  const version = cfg.graphVersion ?? 'v23.0';
  return {
    name: 'whatsapp_cloud' as const,
    async send(m: OutboundWhatsApp) {
      const phoneNumberId = m.sender?.phoneNumberId ?? cfg.phoneNumberId;
      const res = await (cfg.fetch ?? fetch)(
        `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: m.to.replace(/^\+/, ''),
            type: 'template',
            template: whatsappTemplate(m),
            // Echoed in every status webhook: how a status finds our message.
            biz_opaque_callback_data: m.idempotencyKey,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { code?: number; error_subcode?: number };
      };
      const id = json.messages?.[0]?.id;
      if (res.ok && id) return { providerMessageId: id, provider: 'whatsapp_cloud' as const };
      const code = json.error?.code !== undefined ? String(json.error.code) : null;
      if (res.status === 429 || res.status >= 500 || (code && CLOUD_RETRY.has(code)))
        throw new Error(`whatsapp cloud: ${code ?? `HTTP ${res.status}`}`);
      if (code && CLOUD_NOT_ON_WHATSAPP.has(code)) throw new ProviderRejection('not_on_channel', code);
      if (code === '190') throw new Error('whatsapp cloud: access token expired');
      throw new ProviderRejection('rejected', code ?? `HTTP ${res.status}`);
    },
  };
}

/** Meta's webhook signature: `sha256=` + hex HMAC-SHA256 of the raw body under the app secret. */
export function metaSignature(appSecret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}

/** Meta's subscription check (GET): the challenge when the verify token matches, else null. */
export function metaChallenge(verifyToken: string, url: string): string | null {
  const q = new URL(url).searchParams;
  const token = q.get('hub.verify_token') ?? '';
  if (q.get('hub.mode') !== 'subscribe' || !verifyToken || !safeEqual(token, verifyToken)) return null;
  const challenge = q.get('hub.challenge') ?? '';
  return /^[A-Za-z0-9_-]{1,128}$/.test(challenge) ? challenge : null;
}

interface CloudStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  biz_opaque_callback_data?: string;
  errors?: Array<{ code?: number }>;
}
interface CloudInbound {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
}
interface CloudPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        statuses?: CloudStatus[];
        messages?: CloudInbound[];
      };
    }>;
  }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unix = (s: string | undefined, fallback: Date) =>
  s && /^\d{9,11}$/.test(s) ? new Date(Number(s) * 1000) : fallback;

/** One Cloud API status as a delivery event (null for `sent`, sender-side errors, or not ours). */
export function cloudStatusToEvent(s: CloudStatus, now = new Date()): DeliveryEvent | null {
  const ours = s.biz_opaque_callback_data;
  if (!s.id || !s.status || !ours || !UUID.test(ours)) return null;
  const base = {
    id: `${s.id}:${s.status}`,
    messageId: ours,
    providerMessageId: s.id,
    occurredAt: unix(s.timestamp, now),
  };
  if (s.status === 'delivered' || s.status === 'read')
    return DeliveryEvent.parse({ ...base, id: `${s.id}:delivered`, type: 'delivered' });
  if (s.status !== 'failed') return null;
  const code = s.errors?.[0]?.code !== undefined ? String(s.errors[0]?.code) : '';
  if (code && cloudSenderSide(code)) return null;
  return DeliveryEvent.parse({
    ...base,
    type: 'bounced',
    bounceType: CLOUD_NOT_ON_WHATSAPP.has(code) ? 'hard' : 'soft',
    detail: `whatsapp failed${code ? ` ${code}` : ''}`,
  });
}

/** The Cloud API webhook (`POST /api/webhooks/whatsapp/cloud`): statuses and inbound keywords. */
export function whatsappCloudWebhookAdapter(
  cfg: Pick<WhatsAppCloudConfig, 'appSecret'> & { now?: () => Date },
): ProviderWebhookAdapter {
  return {
    name: 'whatsapp_cloud',
    async verify(req) {
      const sig = req.headers.get(META_SIGNATURE_HEADER);
      if (!sig) return fail('missing', 'X-Hub-Signature-256');
      if (!/^sha256=[0-9a-f]{64}$/.test(sig)) return fail('malformed', 'signature');
      if (!safeEqual(sig, metaSignature(cfg.appSecret, req.rawBody))) return fail('invalid');
      let body: CloudPayload;
      try {
        body = JSON.parse(req.rawBody) as CloudPayload;
      } catch {
        return fail('malformed', 'not JSON');
      }
      if (body.object !== 'whatsapp_business_account') return { events: [], inbound: [] };
      const now = cfg.now?.() ?? new Date();
      const events: DeliveryEvent[] = [];
      const inbound: InboundKeyword[] = [];
      const seen = new Set<string>();
      for (const entry of body.entry ?? [])
        for (const change of entry.changes ?? []) {
          if (change.field !== 'messages') continue;
          for (const s of change.value?.statuses ?? []) {
            const e = cloudStatusToEvent(s, now);
            if (e && !seen.has(e.id)) {
              seen.add(e.id);
              events.push(e);
            }
          }
          for (const m of change.value?.messages ?? []) {
            const from = m.from ? `+${m.from.replace(/^\+/, '')}` : '';
            const keyword = parseKeyword(m.type === 'button' ? m.button?.text : m.text?.body);
            if (!m.id || !keyword || !E164_RE.test(from)) continue;
            inbound.push({
              id: m.id,
              channel: 'whatsapp',
              keyword,
              from,
              senderRef: change.value?.metadata?.phone_number_id ?? null,
              receivedAt: unix(m.timestamp, now),
            });
          }
        }
      return { events, inbound };
    },
  };
}

/**
 * The owner's gateway (`WHATSAPP_GATEWAY_URL`, e.g. https://whatsapp.panitechnologies.com).
 * Its contract is pending the owner's API documents (docs/owner-inbox.md); this adapter
 * implements the request signing we proposed for it: `x-pani-key` (key id), `x-pani-timestamp`
 * (unix seconds) and `x-pani-signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`, the
 * same on callbacks, which are refused outside five minutes (replays) and deduplicated by id.
 */
export interface WhatsAppGatewayConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly secret: string;
  readonly callbackOrigin: string;
  readonly fetch?: Fetch;
  readonly now?: () => Date;
}

export const GATEWAY_KEY_HEADER = 'x-pani-key';
export const GATEWAY_TIMESTAMP_HEADER = 'x-pani-timestamp';
export const GATEWAY_SIGNATURE_HEADER = 'x-pani-signature';
export const GATEWAY_TOLERANCE_S = 300;
export const GATEWAY_CALLBACK_PATH = '/api/webhooks/whatsapp/gateway';

export function gatewaySignature(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')}`;
}

export function signGatewayRequest(
  cfg: Pick<WhatsAppGatewayConfig, 'keyId' | 'secret'>,
  body: string,
  now: Date,
) {
  const t = Math.floor(now.getTime() / 1000);
  return {
    [GATEWAY_KEY_HEADER]: cfg.keyId,
    [GATEWAY_TIMESTAMP_HEADER]: String(t),
    [GATEWAY_SIGNATURE_HEADER]: gatewaySignature(cfg.secret, t, body),
  };
}

/** The gateway adapter behind `WhatsAppTransport`. */
export function whatsappGatewayTransport(cfg: WhatsAppGatewayConfig) {
  return {
    name: 'whatsapp_gateway' as const,
    async send(m: OutboundWhatsApp) {
      const tpl = whatsappTemplate(m);
      const body = JSON.stringify({
        to: m.to,
        template: tpl.name,
        language: tpl.language.code,
        params: { org: m.orgName ?? 'Yayatoh', text: m.body },
        category: m.category,
        reference: m.idempotencyKey,
        sender: m.sender?.phoneNumberId ?? null,
        callback_url: `${cfg.callbackOrigin}${GATEWAY_CALLBACK_PATH}`,
      });
      const res = await (cfg.fetch ?? fetch)(`${cfg.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': m.idempotencyKey,
          ...signGatewayRequest(cfg, body, cfg.now?.() ?? new Date()),
        },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.ok && json.id) return { providerMessageId: json.id, provider: 'whatsapp_gateway' as const };
      if (res.status === 429 || res.status >= 500) throw new Error(`whatsapp gateway: HTTP ${res.status}`);
      if (json.error === 'not_on_whatsapp') throw new ProviderRejection('not_on_channel', json.error);
      if (json.error === 'invalid_number') throw new ProviderRejection('invalid_address', json.error);
      throw new ProviderRejection('rejected', json.error ?? `HTTP ${res.status}`);
    },
  };
}

interface GatewayCallback {
  events?: Array<{
    id?: string;
    reference?: string;
    message_id?: string;
    status?: string;
    error?: string;
    at?: string;
  }>;
  inbound?: Array<{ id?: string; from?: string; text?: string; sender?: string; at?: string }>;
}

/** The gateway's callbacks (`POST /api/webhooks/whatsapp/gateway`). */
export function whatsappGatewayWebhookAdapter(
  cfg: Pick<WhatsAppGatewayConfig, 'keyId' | 'secret' | 'now'>,
): ProviderWebhookAdapter {
  return {
    name: 'whatsapp_gateway',
    async verify(req) {
      const key = req.headers.get(GATEWAY_KEY_HEADER);
      const ts = req.headers.get(GATEWAY_TIMESTAMP_HEADER);
      const sig = req.headers.get(GATEWAY_SIGNATURE_HEADER);
      if (!key || !ts || !sig) return fail('missing', 'gateway signature headers');
      if (!/^\d{9,11}$/.test(ts) || !/^v1=[0-9a-f]{64}$/.test(sig)) return fail('malformed', 'signature');
      if (!safeEqual(key, cfg.keyId)) return fail('invalid', 'key id');
      if (!safeEqual(sig, gatewaySignature(cfg.secret, Number(ts), req.rawBody))) return fail('invalid');
      const now = cfg.now?.() ?? new Date();
      if (Math.abs(now.getTime() / 1000 - Number(ts)) > GATEWAY_TOLERANCE_S) return fail('replayed');
      let body: GatewayCallback;
      try {
        body = JSON.parse(req.rawBody) as GatewayCallback;
      } catch {
        return fail('malformed', 'not JSON');
      }
      const at = (s: string | undefined) => (s && Number.isFinite(Date.parse(s)) ? new Date(s) : now);
      const events: DeliveryEvent[] = [];
      for (const e of body.events ?? []) {
        if (!e.id || !e.reference || !UUID.test(e.reference) || !e.status) continue;
        const base = {
          id: `gw:${e.id}`,
          messageId: e.reference,
          providerMessageId: e.message_id ?? null,
          occurredAt: at(e.at),
        };
        if (e.status === 'delivered' || e.status === 'read')
          events.push(DeliveryEvent.parse({ ...base, type: 'delivered' }));
        else if (e.status === 'failed')
          events.push(
            DeliveryEvent.parse({
              ...base,
              type: 'bounced',
              bounceType: e.error === 'not_on_whatsapp' || e.error === 'invalid_number' ? 'hard' : 'soft',
              detail: `gateway failed${e.error ? ` ${e.error.slice(0, 100)}` : ''}`,
            }),
          );
      }
      const inbound: InboundKeyword[] = [];
      for (const m of body.inbound ?? []) {
        const keyword = parseKeyword(m.text);
        if (!m.id || !keyword || !m.from || !E164_RE.test(m.from)) continue;
        inbound.push({
          id: `gw:${m.id}`,
          channel: 'whatsapp',
          keyword,
          from: m.from,
          senderRef: m.sender ?? null,
          receivedAt: at(m.at),
        });
      }
      return { events, inbound };
    },
  };
}

/** Routes WhatsApp per org: the org's route when it has one, else the platform default (P3-2). */
export function routedWhatsAppTransport(routes: {
  readonly cloud?: {
    send(m: OutboundWhatsApp): Promise<{ providerMessageId: string; provider?: string }>;
  } | null;
  readonly gateway?: {
    send(m: OutboundWhatsApp): Promise<{ providerMessageId: string; provider?: string }>;
  } | null;
  readonly defaultRoute: 'cloud' | 'gateway';
}) {
  return {
    name: 'whatsapp_router' as const,
    async send(m: OutboundWhatsApp) {
      const route = m.sender?.route ?? routes.defaultRoute;
      const provider = route === 'gateway' ? 'whatsapp_gateway' : 'whatsapp_cloud';
      const t = route === 'gateway' ? routes.gateway : routes.cloud;
      if (!t) throw tagErrorProvider(new Error(`no WhatsApp ${route} adapter configured`), provider);
      try {
        const sent = await t.send(m);
        return { ...sent, provider: sent.provider ?? provider };
      } catch (err) {
        throw tagErrorProvider(err, provider);
      }
    },
  };
}
