import { contactByIdTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { eq } from 'drizzle-orm';
import type { Category } from './kinds.ts';
import { decryptParams } from './notifier.ts';
import { recipientKey } from './policy/gate.ts';
import { hasPushDeviceTx } from './push.ts';
import { FALLBACK_REASONS, messages } from './schema.ts';

/**
 * Fallback chains (M3.5b). When a message can't reach the person on its channel for a
 * *reachability* reason (no number, not on WhatsApp, an invalid or undeliverable number, a bounced
 * address, no push device, a provider that refused it for good), the category's next channel gets
 * the same message. Never for the person's own choices or the rules (no consent on that channel,
 * unsubscribed, preferences, STOP, complaints, erasure, WhatsApp category rules) or holds (quiet
 * hours, caps, quotas, pauses): an organizer's SMS-only announcement to someone who never agreed to
 * texts stays blocked with its reason rather than turning into an email.
 *
 * Never double-sends: the next channel's row uses the message's own dedupe key, so the unique
 * `(org, channel, dedupe_key)` inserts it once however many retries, webhooks or workers race;
 * and a channel that already has the message (queued or sent) ends the chain.
 */
export type FallbackChannel = 'whatsapp' | 'sms' | 'email' | 'push';
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/** Per category, in order (pending the owner; recommended defaults). Marketing never falls back. */
export const FALLBACK_CHAINS: Readonly<Record<Category, readonly FallbackChannel[]>> = {
  transactional: ['whatsapp', 'sms', 'email'],
  reminders: ['whatsapp', 'sms', 'email'],
  event_updates: ['whatsapp', 'sms', 'email'],
  // Each channel needs its own express consent for marketing; no automatic escalation.
  marketing: [],
  sales: ['push', 'email'],
  messages: ['push', 'email'],
  security: ['push', 'email'],
};

/** The dispatcher's and webhooks' reasons that let a message try the next channel. */
export function isFallbackReason(reason: string | null | undefined): reason is FallbackReason {
  return (FALLBACK_REASONS as readonly string[]).includes(reason ?? '');
}

/**
 * The channels to try after `channel`, in order, skipping those that already have this message
 * in a final failed state (`skip`); null when the reason or the category doesn't fall back.
 */
export function planFallback(input: {
  readonly category: string;
  readonly channel: string;
  readonly reason: string | null | undefined;
}): FallbackChannel[] | null {
  if (!isFallbackReason(input.reason)) return null;
  const chain = FALLBACK_CHAINS[input.category as Category] ?? [];
  const at = chain.indexOf(input.channel as FallbackChannel);
  if (at < 0) return null;
  const rest = chain.slice(at + 1);
  return rest.length ? rest : null;
}

export interface FallbackOutcome {
  /** The channel that now carries the message, or null when the chain ran out. */
  readonly channel: FallbackChannel | null;
  /** A row was inserted (false: the channel already had the message). */
  readonly created: boolean;
}

type Row = typeof messages.$inferSelect;

/**
 * Hand a message that failed on its channel to the category's next reachable channel, in the
 * caller's transaction (so the failure and the fallback commit together).
 */
export async function fallbackTx(
  tx: TenantTx,
  orgId: string,
  row: Row,
  reason: string,
  now: Date,
): Promise<FallbackOutcome | null> {
  const plan = planFallback({ category: row.category, channel: row.channel, reason });
  if (!plan) return null;
  const siblings = await tx
    .select({ channel: messages.channel, status: messages.status })
    .from(messages)
    .where(eq(messages.dedupeKey, row.dedupeKey));
  const byChannel = new Map(siblings.map((s) => [s.channel, s.status]));
  const params = await decryptParams(orgId, row.paramsCiphertext);
  const phone = typeof params._phone === 'string' && params._phone ? params._phone : null;
  let contactEmail: string | null | undefined;
  const emailOf = async () => {
    if (row.recipientEmail) return row.recipientEmail;
    if (contactEmail === undefined)
      contactEmail = row.contactId ? ((await contactByIdTx(tx, row.contactId))?.email ?? null) : null;
    return contactEmail;
  };
  for (const channel of plan) {
    const status = byChannel.get(channel);
    // Already queued or sent there: the person gets it on that channel; the chain ends.
    if (status === 'queued' || status === 'sent') return { channel, created: false };
    if (status) continue;
    let email: string | null = null;
    if (channel === 'sms' || channel === 'whatsapp') {
      if (!phone) continue;
    } else if (channel === 'email') {
      email = await emailOf();
      if (!email && !row.recipientUserId) continue;
    } else if (!(await hasPushDeviceTx(tx, { userId: row.recipientUserId, email: row.recipientEmail })))
      continue;
    const key =
      channel === 'email'
        ? recipientKey('email', email ?? (row.recipientUserId ? `user:${row.recipientUserId}` : null))
        : channel === 'push'
          ? recipientKey('push', row.recipientUserId)
          : recipientKey(channel, phone);
    const inserted = await tx
      .insert(messages)
      .values({
        orgId,
        kind: row.kind,
        category: row.category,
        channel,
        dedupeKey: row.dedupeKey,
        recipientEmail: channel === 'sms' ? null : (email ?? row.recipientEmail),
        recipientUserId: row.recipientUserId,
        recipientName: row.recipientName,
        locale: row.locale,
        timeZone: row.timeZone,
        orderId: row.orderId,
        eventId: row.eventId,
        occurrenceId: row.occurrenceId,
        contactId: row.contactId,
        recipientRegion: row.recipientRegion,
        recipientKey: key,
        paramsCiphertext: row.paramsCiphertext,
        sendAfter: now,
        fallbackOf: row.id,
        fallbackReason: reason as FallbackReason,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    return { channel, created: inserted.length > 0 };
  }
  return { channel: null, created: false };
}
