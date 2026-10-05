import type { TenantTx } from '@yayatoh/db';
import { and, inArray, like } from 'drizzle-orm';
import { messages } from './schema.ts';

/**
 * Delivery states of messages by their dedupe keys (M4.1f): what another module shows next to
 * the thing it sent (a wedding party's invitations and reminders: sent, waiting for quiet hours,
 * bounced, failed). Ids, channel and states only; never the address, subject or params. Runs in
 * the caller's tenant transaction, so only the org's own messages are visible.
 */
export interface MessageState {
  readonly dedupeKey: string;
  readonly channel: string;
  /** queued, sent, suppressed, failed, canceled. */
  readonly status: string;
  /** Why it waits or was not sent (quiet_hours, bounced, no_address, provider_error…). */
  readonly reason: string | null;
  /** The provider's latest report: delivered, bounced, soft_bounced, complained. */
  readonly delivery: string | null;
  readonly sendAfter: Date;
  readonly sentAt: Date | null;
  /** The message this one replaces on another channel (fallback chains). */
  readonly fallbackOf: string | null;
}

const toState = (r: typeof messages.$inferSelect): MessageState => ({
  dedupeKey: r.dedupeKey,
  channel: r.channel,
  status: r.status,
  reason: r.reason,
  delivery: r.delivery,
  sendAfter: r.sendAfter,
  sentAt: r.sentAt,
  fallbackOf: r.fallbackOf,
});

/** States of the messages queued under these keys (every channel). */
export async function messageStatesTx(tx: TenantTx, keys: readonly string[]): Promise<MessageState[]> {
  if (keys.length === 0) return [];
  const rows = await tx
    .select()
    .from(messages)
    .where(inArray(messages.dedupeKey, [...new Set(keys)]));
  return rows.map(toState);
}

/** States of the messages whose dedupe key starts with `prefix` (at most `limit`). */
export async function messageStatesByPrefixTx(
  tx: TenantTx,
  prefix: string,
  limit = 500,
): Promise<MessageState[]> {
  const rows = await tx
    .select()
    .from(messages)
    .where(and(like(messages.dedupeKey, `${prefix.replace(/[\\%_]/g, '\\$&')}%`)))
    .limit(limit);
  return rows.map(toState);
}
