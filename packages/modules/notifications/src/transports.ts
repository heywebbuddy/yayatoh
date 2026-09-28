import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DeliveryEvent, signFakeDeliveryEvents } from './delivery.ts';
import type { Urgency } from './web-push.ts';

/**
 * Channel adapters (roadmap §6.4 `ChannelAdapter`). Production adapters need the owner's
 * accounts (SES, Twilio toll-free/10DLC, WhatsApp gateway, FCM v1, APNs, VAPID; see
 * docs/owner-inbox.md). Until then development, preview and CI use the fakes below: a dev
 * mailbox on disk (read by /dev/mailbox) and recorded fakes for SMS and push.
 */
export interface OutboundEmail {
  readonly from: { readonly name: string; readonly address: string };
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The delivery id: providers that support idempotency get it; logs carry it. */
  readonly idempotencyKey: string;
}

export interface EmailTransport {
  send(message: OutboundEmail): Promise<{ readonly providerMessageId: string }>;
}

export interface OutboundSms {
  readonly to: string;
  readonly body: string;
  readonly idempotencyKey: string;
}

export interface SmsTransport {
  send(message: OutboundSms): Promise<{ readonly providerMessageId: string }>;
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
  send(message: OutboundPush): Promise<PushSendResult>;
}

export interface Transports {
  readonly email: EmailTransport;
  readonly sms?: SmsTransport;
  readonly push?: PushTransport;
}

/** The platform sender (roadmap §4.4: `mail.yayatoh.com` with the org's display name from M1.10). */
export const PLATFORM_SENDER = 'notifications@mail.yayatoh.com';

/** Tests: records every send; `delayMs` widens race windows in concurrency tests. */
export function memoryTransports(opts: { delayMs?: number } = {}) {
  const emails: OutboundEmail[] = [];
  const sms: OutboundSms[] = [];
  const pushes: OutboundPush[] = [];
  const invalid = new Set<string>();
  /** Tokens whose service answers 429 (with this Retry-After in ms), or refuses the message. */
  const busy = new Map<string, number | null>();
  const rejected = new Set<string>();
  const wait = () => (opts.delayMs ? new Promise((r) => setTimeout(r, opts.delayMs)) : Promise.resolve());
  const transports: Transports = {
    email: {
      async send(m) {
        await wait();
        emails.push(m);
        return { providerMessageId: `mem-${emails.length}` };
      },
    },
    sms: {
      async send(m) {
        sms.push(m);
        return { providerMessageId: `mem-sms-${sms.length}` };
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
  return { transports, emails, sms, pushes, invalid, busy, rejected };
}

export interface DevMailboxEntry extends OutboundEmail {
  readonly id: string;
  readonly at: string;
  readonly channel: 'email' | 'sms' | 'push';
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
    return { providerMessageId };
  };
  const blank = { from: { name: '', address: '' }, html: '', headers: {} };
  return {
    email: { send: async (m) => write('email', m) },
    sms: {
      send: async (m) =>
        write('sms', { ...blank, to: m.to, subject: '', text: m.body, idempotencyKey: m.idempotencyKey }),
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
 * renaming it, so two drains never post the same report; the webhook dedupes anyway).
 */
export function takeDevDeliveryEvents(dir = devMailboxDir()): Array<{ body: string; signature: string }> {
  const folder = join(dir, EVENTS_DIR);
  let files: string[];
  try {
    files = readdirSync(folder).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Array<{ body: string; signature: string }> = [];
  for (const f of files.sort()) {
    const claimed = join(folder, `${f}.${process.pid}.claimed`);
    try {
      renameSync(join(folder, f), claimed);
    } catch {
      continue;
    }
    out.push(JSON.parse(readFileSync(claimed, 'utf8')));
    rmSync(claimed, { force: true });
  }
  return out;
}
