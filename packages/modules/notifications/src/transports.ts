import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DeliveryEvent, signFakeDeliveryEvents } from './delivery.ts';
import { ProviderRejection } from './providers/types.ts';
import type { Urgency } from './web-push.ts';

/**
 * Channel adapters (roadmap §6.4 `ChannelAdapter`). Production adapters need the owner's
 * accounts (SES, Twilio toll-free/10DLC, WhatsApp gateway, FCM v1, APNs, VAPID; see
 * docs/owner-inbox.md). Until then development, preview and CI use the fakes below: a dev
 * mailbox on disk (read by /dev/mailbox) and recorded fakes for SMS and push.
 */
export interface OutboundEmail {
  readonly from: { readonly name: string; readonly address: string };
  /** U10: where replies go (the org's "Email sending" setting); absent: replies go to the From. */
  readonly replyTo?: string | null;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The delivery id: providers that support idempotency get it; logs carry it. */
  readonly idempotencyKey: string;
  /**
   * The org's own verified sending domain (M3.5b): its From address and SES configuration set.
   * Absent: the platform sender (`from`).
   */
  readonly sender?: { readonly address: string; readonly configurationSet?: string | null } | null;
  /** The org (SES message tag), for provider-side reporting. */
  readonly orgId?: string | null;
}

/** What a provider returns for an accepted message; `provider` names the adapter that sent it. */
export interface SendResult {
  readonly providerMessageId: string;
  readonly provider?: string;
}

export interface EmailTransport {
  readonly name?: string;
  send(message: OutboundEmail): Promise<SendResult>;
}

export interface OutboundSms {
  readonly to: string;
  readonly body: string;
  readonly idempotencyKey: string;
  /** The org's own 10DLC Messaging Service (M3.5b); absent: the platform's. */
  readonly sender?: { readonly messagingServiceSid: string } | null;
}

export interface SmsTransport {
  readonly name?: string;
  send(message: OutboundSms): Promise<SendResult>;
}

/**
 * WhatsApp (M3.5a port; D16 / 2026-09-28: one port, two adapters — the Cloud API for new
 * tenants and the owner's gateway for existing flows — both arrive in M3.5b). `category` is the
 * template category Meta bills and reviews (utility, marketing, authentication).
 */
export interface OutboundWhatsApp {
  readonly to: string;
  readonly body: string;
  readonly category: 'utility' | 'marketing' | 'authentication';
  readonly idempotencyKey: string;
  /** Template language and the org name parameter (M3.5b templates). */
  readonly locale?: string;
  readonly orgName?: string;
  /** The org's route (Cloud API or the owner's gateway) and its own number, if any (M3.5b). */
  readonly sender?: { readonly route: 'cloud' | 'gateway'; readonly phoneNumberId?: string | null } | null;
}

export interface WhatsAppTransport {
  readonly name?: string;
  send(message: OutboundWhatsApp): Promise<SendResult>;
}

export interface OutboundPush {
  readonly platform: 'fcm' | 'apns' | 'webpush';
  /** The device token; for web push the subscription's endpoint URL. */
  readonly token: string;
  /** Web push only: the subscription's `p256dh` and `auth` (RFC 8291). */
  readonly keys?: { readonly p256dh: string; readonly auth: string } | null;
  readonly title: string;
  readonly body: string;
  /** A link on our own origin, or null. */
  readonly url: string | null;
  readonly idempotencyKey: string;
  /** How long the push service may hold it (RFC 8030 TTL), seconds. */
  readonly ttlSeconds?: number;
  readonly urgency?: Urgency;
  /** Collapses retries of one message on the push service (RFC 8030 Topic). */
  readonly topic?: string | null;
  /** Language and direction of the text (the notification renders RTL for Arabic). */
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
}

export type PushSendResult =
  | { readonly providerMessageId: string }
  /** The device is gone (FCM UNREGISTERED, APNs 410, web push 404/410): disable the token. */
  | { readonly error: 'invalid_token'; readonly status?: number }
  /** Rate limited or the service is down (429, 5xx, network): try later. */
  | { readonly error: 'retry'; readonly status?: number; readonly retryAfterMs?: number | null }
  /** The service refused this message for good (400, 403, 413…): don't retry it. */
  | { readonly error: 'rejected'; readonly status?: number; readonly detail?: string };

export interface PushTransport {
  readonly name?: string;
  send(message: OutboundPush): Promise<PushSendResult>;
}

export interface Transports {
  readonly email: EmailTransport;
  readonly sms?: SmsTransport;
  readonly whatsapp?: WhatsAppTransport;
  readonly push?: PushTransport;
}

/** The platform sender (roadmap §4.4: `mail.yayatoh.com` with the org's display name from M1.10). */
export const PLATFORM_SENDER = 'notifications@mail.yayatoh.com';

/**
 * Tests: records every send; `delayMs` widens race windows in concurrency tests. Numbers in
 * `notOnWhatsApp` are refused like the Cloud API's 131026, in `badNumbers` like Twilio's 21614;
 * `failing` channels throw (a provider outage).
 */
export function memoryTransports(opts: { delayMs?: number } = {}) {
  const notOnWhatsApp = new Set<string>();
  const badNumbers = new Set<string>();
  const failing = new Set<'email' | 'sms' | 'whatsapp'>();
  const emails: OutboundEmail[] = [];
  const sms: OutboundSms[] = [];
  const pushes: OutboundPush[] = [];
  const whatsapp: OutboundWhatsApp[] = [];
  const invalid = new Set<string>();
  /** Tokens whose service answers 429 (with this Retry-After in ms), or refuses the message. */
  const busy = new Map<string, number | null>();
  const rejected = new Set<string>();
  const wait = () => (opts.delayMs ? new Promise((r) => setTimeout(r, opts.delayMs)) : Promise.resolve());
  const down = (channel: 'email' | 'sms' | 'whatsapp') => {
    if (failing.has(channel)) throw new Error(`memory ${channel}: provider down`);
  };
  const transports: Transports = {
    email: {
      name: 'memory',
      async send(m) {
        await wait();
        down('email');
        emails.push(m);
        return { providerMessageId: `mem-${emails.length}`, provider: 'memory' };
      },
    },
    sms: {
      name: 'memory',
      async send(m) {
        down('sms');
        if (badNumbers.has(m.to)) throw new ProviderRejection('invalid_address', '21614');
        sms.push(m);
        return { providerMessageId: `mem-sms-${sms.length}`, provider: 'memory' };
      },
    },
    whatsapp: {
      name: 'memory',
      async send(m) {
        down('whatsapp');
        if (notOnWhatsApp.has(m.to)) throw new ProviderRejection('not_on_channel', '131026');
        whatsapp.push(m);
        return { providerMessageId: `mem-wa-${whatsapp.length}`, provider: 'memory' };
      },
    },
    push: {
      async send(m) {
        if (invalid.has(m.token)) return { error: 'invalid_token' as const, status: 410 };
        if (busy.has(m.token))
          return { error: 'retry' as const, status: 429, retryAfterMs: busy.get(m.token) ?? null };
        if (rejected.has(m.token)) return { error: 'rejected' as const, status: 413 };
        await wait();
        pushes.push(m);
        return { providerMessageId: `mem-push-${pushes.length}` };
      },
    },
  };
  return {
    transports,
    emails,
    sms,
    whatsapp,
    pushes,
    invalid,
    busy,
    rejected,
    notOnWhatsApp,
    badNumbers,
    failing,
  };
}

export interface DevMailboxEntry extends OutboundEmail {
  readonly id: string;
  readonly at: string;
  readonly channel: 'email' | 'sms' | 'whatsapp' | 'push';
}

export const devMailboxDir = () => process.env.DEV_MAILBOX_DIR ?? join(tmpdir(), 'yayatoh-dev-mailbox');

const EVENTS_DIR = 'delivery-events';

/**
 * What the fake provider reports for an address (like SES's mailbox simulator): the local part
 * before any `+tag` decides. `bounce@` hard-bounces, `softbounce@` soft-bounces, `complaint@` is
 * delivered and then complained about; everything else is delivered.
 */
export function fakeOutcome(address: string): Array<Pick<DeliveryEvent, 'type' | 'bounceType' | 'detail'>> {
  const local = (address.split('@')[0] ?? '').split('+')[0]?.toLowerCase() ?? '';
  if (local === 'bounce') return [{ type: 'bounced', bounceType: 'hard', detail: '550 5.1.1 user unknown' }];
  if (local === 'softbounce')
    return [{ type: 'bounced', bounceType: 'soft', detail: '452 4.2.2 mailbox full' }];
  if (local === 'complaint')
    return [
      { type: 'delivered', bounceType: null, detail: null },
      { type: 'complained', bounceType: null, detail: 'abuse' },
    ];
  return [{ type: 'delivered', bounceType: null, detail: null }];
}

/**
 * Development and CI: every message is written as JSON to a local folder that the web app's
 * dev mailbox (`/dev/mailbox`, dev auth only) reads. Refuses to run in production. With a
 * `deliverySecret`, each email also leaves the fake provider's signed delivery report
 * (`fakeOutcome`) in `delivery-events/`, which the dev drain posts through the webhook path.
 */
export function devMailboxTransports(
  dir = devMailboxDir(),
  opts: { deliverySecret?: string | null } = {},
): Transports {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The dev mailbox is not allowed in production');
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const write = (channel: DevMailboxEntry['channel'], m: OutboundEmail) => {
    const at = new Date().toISOString();
    const id = `${at.replace(/[:.]/g, '-')}-${process.pid}-${++n}`;
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({ ...m, id, at, channel } satisfies DevMailboxEntry),
    );
    const providerMessageId = `dev-${id}`;
    const provider = 'dev';
    if (channel === 'email' && opts.deliverySecret && /^[0-9a-f-]{36}$/.test(m.idempotencyKey)) {
      mkdirSync(join(dir, EVENTS_DIR), { recursive: true });
      const signed = signFakeDeliveryEvents(
        opts.deliverySecret,
        fakeOutcome(m.to).map((o) => ({
          ...o,
          messageId: m.idempotencyKey,
          providerMessageId,
          recipient: m.to,
        })),
      );
      writeFileSync(join(dir, EVENTS_DIR, `${id}.json`), JSON.stringify(signed));
    }
    return { providerMessageId, provider };
  };
  const blank = { from: { name: '', address: '' }, html: '', headers: {} };
  return {
    email: { name: 'dev', send: async (m) => write('email', m) },
    sms: {
      name: 'dev',
      send: async (m) =>
        write('sms', { ...blank, to: m.to, subject: '', text: m.body, idempotencyKey: m.idempotencyKey }),
    },
    whatsapp: {
      name: 'dev',
      send: async (m) =>
        write('whatsapp', {
          ...blank,
          to: m.to,
          subject: m.category,
          text: m.body,
          idempotencyKey: m.idempotencyKey,
        }),
    },
    push: {
      send: async (m) =>
        write('push', {
          ...blank,
          to: `${m.platform}:${m.token}`,
          subject: m.title,
          text: m.url ? `${m.body}\n${m.url}` : m.body,
          idempotencyKey: m.idempotencyKey,
        }),
    },
  };
}

/** Newest first; optionally only messages to one address, or the one entry with `id`. */
export function readDevMailbox(
  opts: { to?: string; limit?: number; id?: string } = {},
  dir = devMailboxDir(),
): DevMailboxEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  if (opts.id !== undefined) {
    const file = `${opts.id}.json`;
    return /^[A-Za-z0-9-]+$/.test(opts.id) && files.includes(file)
      ? [JSON.parse(readFileSync(join(dir, file), 'utf8')) as DevMailboxEntry]
      : [];
  }
  const to = opts.to?.trim().toLowerCase();
  const out: DevMailboxEntry[] = [];
  for (const f of files.sort().reverse()) {
    const entry = JSON.parse(readFileSync(join(dir, f), 'utf8')) as DevMailboxEntry;
    if (to && entry.to.toLowerCase() !== to) continue;
    out.push(entry);
    if (out.length >= (opts.limit ?? 50)) break;
  }
  return out;
}

/**
 * Dev/CI: take the fake provider's pending delivery reports (each once: a file is claimed by
 * renaming it, so two drains never post the same report; the webhook dedupes anyway). A claimed
 * report stays on disk until its taker has posted it (`releaseDevDeliveryEvent`), so another
 * drain can wait for it (`settleDevDeliveryEvents`).
 */
export function takeDevDeliveryEvents(
  dir = devMailboxDir(),
): Array<{ body: string; signature: string; claimed: string }> {
  const folder = join(dir, EVENTS_DIR);
  let files: string[];
  try {
    files = readdirSync(folder).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Array<{ body: string; signature: string; claimed: string }> = [];
  for (const f of files.sort()) {
    const claimed = join(folder, `${f}.${process.pid}.claimed`);
    try {
      renameSync(join(folder, f), claimed);
      // The claim's time: a claim left behind by a process that died is ignored after a minute.
      const now = new Date();
      utimesSync(claimed, now, now);
    } catch {
      continue;
    }
    out.push({ ...JSON.parse(readFileSync(claimed, 'utf8')), claimed });
  }
  return out;
}

const STALE_CLAIM_MS = 60_000;

/** Dev/CI: a taken report has been posted (or given up on). */
export function releaseDevDeliveryEvent(claimed: string): void {
  rmSync(claimed, { force: true });
}

/**
 * Dev/CI (batch 3g merge): wait until no report is still claimed by another drain, so a drain
 * that sent a message returns only after its delivery report was recorded, even when a drain
 * running at the same time took that report (the messaging e2e read a bounce too early).
 * Bounded: gives up after `timeoutMs`; claims older than a minute (a process that died) are ignored.
 */
export async function settleDevDeliveryEvents(dir = devMailboxDir(), timeoutMs = 15_000): Promise<boolean> {
  const folder = join(dir, EVENTS_DIR);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let pending: string[];
    try {
      pending = readdirSync(folder).filter((f) => {
        if (!f.endsWith('.claimed')) return false;
        try {
          return Date.now() - statSync(join(folder, f)).mtimeMs < STALE_CLAIM_MS;
        } catch {
          return false;
        }
      });
    } catch {
      return true;
    }
    if (pending.length === 0) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Until the owner's email provider account exists (SES), platform notices outside development
 * are logged instead of sent: the subject and a masked recipient only, never the body.
 */
export function consoleTransport(): EmailTransport {
  return {
    async send(m) {
      const [local = '', domain = ''] = m.to.split('@');
      console.info(
        JSON.stringify({
          mail: 'notice',
          to: `${local.slice(0, 1)}•••@${domain}`,
          subject: m.subject,
          id: m.idempotencyKey,
        }),
      );
      return { providerMessageId: `console-${m.idempotencyKey}` };
    },
  };
}

/** What the dev/CI fake push service received for one subscription (M1.10e). */
export interface FakePushEntry {
  readonly at: string;
  /** The encrypted `aes128gcm` body, base64url: tests decrypt it with the browser's keys. */
  readonly body: string;
  readonly ttl: string | null;
  readonly urgency: string | null;
  readonly topic: string | null;
  readonly contentEncoding: string | null;
  /** The verified VAPID `sub` claim. */
  readonly subject: string;
}

const PUSH_SERVICE_DIR = 'push-service';
const FAKE_PUSH_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Dev/CI: keep one received push for a fake subscription id (refused in production). */
export function recordFakePush(id: string, entry: FakePushEntry, dir = devMailboxDir()): void {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The fake push service is not allowed in production');
  if (!FAKE_PUSH_ID.test(id)) throw new Error('bad fake push id');
  const folder = join(dir, PUSH_SERVICE_DIR, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(
      folder,
      `${entry.at.replace(/[:.]/g, '-')}-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    ),
    JSON.stringify(entry),
  );
}

/** Dev/CI: what the fake push service received for this id, oldest first. */
export function readFakePushes(id: string, dir = devMailboxDir()): FakePushEntry[] {
  if (!FAKE_PUSH_ID.test(id)) return [];
  const folder = join(dir, PUSH_SERVICE_DIR, id);
  let files: string[];
  try {
    files = readdirSync(folder).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.sort().map((f) => JSON.parse(readFileSync(join(folder, f), 'utf8')) as FakePushEntry);
}
