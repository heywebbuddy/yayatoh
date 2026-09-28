import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DeliveryEvent, signFakeDeliveryEvents } from './delivery.ts';

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
}

export interface WhatsAppTransport {
  send(message: OutboundWhatsApp): Promise<{ readonly providerMessageId: string }>;
}

export interface OutboundPush {
  readonly platform: 'fcm' | 'apns' | 'webpush';
  readonly token: string;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly idempotencyKey: string;
}

export interface PushTransport {
  /** `invalid_token` tells the dispatcher to disable the token (FCM UNREGISTERED, APNs 410). */
  send(
    message: OutboundPush,
  ): Promise<{ readonly providerMessageId: string } | { readonly error: 'invalid_token' }>;
}

export interface Transports {
  readonly email: EmailTransport;
  readonly sms?: SmsTransport;
  readonly whatsapp?: WhatsAppTransport;
  readonly push?: PushTransport;
}

/** The platform sender (roadmap §4.4: `mail.yayatoh.com` with the org's display name from M1.10). */
export const PLATFORM_SENDER = 'notifications@mail.yayatoh.com';

/** Tests: records every send; `delayMs` widens race windows in concurrency tests. */
export function memoryTransports(opts: { delayMs?: number } = {}) {
  const emails: OutboundEmail[] = [];
  const sms: OutboundSms[] = [];
  const pushes: OutboundPush[] = [];
  const whatsapp: OutboundWhatsApp[] = [];
  const invalid = new Set<string>();
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
    whatsapp: {
      async send(m) {
        whatsapp.push(m);
        return { providerMessageId: `mem-wa-${whatsapp.length}` };
      },
    },
    push: {
      async send(m) {
        if (invalid.has(m.token)) return { error: 'invalid_token' as const };
        pushes.push(m);
        return { providerMessageId: `mem-push-${pushes.length}` };
      },
    },
  };
  return { transports, emails, sms, whatsapp, pushes, invalid };
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
    whatsapp: {
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
