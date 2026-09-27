import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
        if (invalid.has(m.token)) return { error: 'invalid_token' as const };
        pushes.push(m);
        return { providerMessageId: `mem-push-${pushes.length}` };
      },
    },
  };
  return { transports, emails, sms, pushes, invalid };
}

export interface DevMailboxEntry extends OutboundEmail {
  readonly id: string;
  readonly at: string;
  readonly channel: 'email' | 'sms' | 'push';
}

export const devMailboxDir = () => process.env.DEV_MAILBOX_DIR ?? join(tmpdir(), 'yayatoh-dev-mailbox');

/**
 * Development and CI: every message is written as JSON to a local folder that the web app's
 * dev mailbox (`/dev/mailbox`, dev auth only) reads. Refuses to run in production.
 */
export function devMailboxTransports(dir = devMailboxDir()): Transports {
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
    return { providerMessageId: `dev-${id}` };
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

/** Newest first; optionally only messages to one address. */
export function readDevMailbox(
  opts: { to?: string; limit?: number } = {},
  dir = devMailboxDir(),
): DevMailboxEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
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
