import { timingSafeEqual } from 'node:crypto';
import type { DeliveryEvent } from '../delivery.ts';

/**
 * Shared shapes of the provider adapters (M3.5b). Every real adapter is selected by a config name
 * (`EMAIL_PROVIDER`, `SMS_PROVIDER`, `WHATSAPP_PROVIDER`; see `.env.example`) and talks to its
 * provider through an injected `fetch`, so tests run against recorded (synthetic) payloads and
 * never reach a network.
 */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Provider names as recorded in `message_events.provider`, `messages.provider` and health. */
export const PROVIDER_NAMES = [
  'ses',
  'twilio',
  'whatsapp_cloud',
  'whatsapp_gateway',
  'fake',
  'dev',
  'memory',
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** The real providers (staff console health and switch-on checklists). */
export const REAL_PROVIDERS = ['ses', 'twilio', 'whatsapp_cloud', 'whatsapp_gateway'] as const;
export type RealProvider = (typeof REAL_PROVIDERS)[number];

/**
 * Why a provider refused a message for good (no retry): the dispatcher records the reason and,
 * for reachability reasons, tries the category's next channel (fallback chains).
 * - `not_on_channel`: the number has no WhatsApp account (Cloud API 131026, gateway `not_on_whatsapp`);
 * - `invalid_address`: not a valid or not a mobile number (Twilio 21211, 21614);
 * - `opted_out`: the person replied STOP to this sender (Twilio 21610);
 * - `rejected`: anything else the provider will never accept (content, template).
 */
export const REJECTION_CODES = ['not_on_channel', 'invalid_address', 'opted_out', 'rejected'] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export class ProviderRejection extends Error {
  readonly code: RejectionCode;
  readonly providerCode: string | null;
  constructor(code: RejectionCode, providerCode: string | null, message?: string) {
    super(message ?? `refused by the provider (${code}${providerCode ? ` ${providerCode}` : ''})`);
    this.name = 'ProviderRejection';
    this.code = code;
    this.providerCode = providerCode;
  }
}

export function isProviderRejection(err: unknown): err is ProviderRejection {
  return err instanceof ProviderRejection;
}

/** A webhook request as the endpoint received it: the raw body is what signatures cover. */
export interface WebhookRequest {
  readonly rawBody: string;
  readonly headers: Headers;
  /** The full public URL the provider called (Twilio signs it, with the query). */
  readonly url: string;
}

/** Inbound keywords (STOP/START/HELP) feed the consent ledger (M3.5b). */
export const KEYWORDS = ['stop', 'start', 'help'] as const;
export type Keyword = (typeof KEYWORDS)[number];

export interface InboundKeyword {
  /** The provider's id of the inbound message (deduplication key). */
  readonly id: string;
  readonly channel: 'sms' | 'whatsapp';
  readonly keyword: Keyword;
  /** The person's number (E.164). */
  readonly from: string;
  /** Which of our senders they wrote to: a messaging service SID, a number or a phone number id. */
  readonly senderRef: string | null;
  readonly receivedAt: Date;
}

export interface VerifiedWebhook {
  readonly events: DeliveryEvent[];
  readonly inbound: InboundKeyword[];
  /** A subscription handshake the adapter completed (SNS SubscriptionConfirmation). */
  readonly confirmed?: boolean;
}

/** Verifies a provider's webhook (signature on the raw body) and parses what it reports. */
export interface ProviderWebhookAdapter {
  readonly name: ProviderName;
  verify(req: WebhookRequest): Promise<VerifiedWebhook>;
}

export const WEBHOOK_FAILURES = ['missing', 'malformed', 'invalid', 'replayed', 'untrusted'] as const;
export type WebhookFailure = (typeof WEBHOOK_FAILURES)[number];

/** A webhook that failed verification (400 at the endpoint; counted in provider health). */
export class WebhookVerificationError extends Error {
  readonly failure: WebhookFailure;
  constructor(failure: WebhookFailure, message?: string) {
    super(message ?? failure);
    this.name = 'WebhookVerificationError';
    this.failure = failure;
  }
}

export const fail = (failure: WebhookFailure, message?: string): never => {
  throw new WebhookVerificationError(failure, message);
};

/** Constant-time comparison of two strings (signatures). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const E164_RE = /^\+[1-9][0-9]{6,14}$/;
