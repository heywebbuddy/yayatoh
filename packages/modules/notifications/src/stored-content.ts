import { normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { and, count, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { addressSuppressions, messages, storedContents, suppressions } from './schema.ts';
import { applyMerge, recipientValues } from './templates/merge.ts';

/**
 * Stored content (M3.6b): campaigns render their blocks once, store the result here and queue one
 * message per recipient that points at it (`params._content`). The dispatcher fills the merge
 * fields per recipient and the unsubscribe link per message.
 */
export type StoredContent = typeof storedContents.$inferSelect;

export async function storeContentTx(
  tx: TenantTx,
  orgId: string,
  input: {
    subject: string;
    preheader?: string;
    html: string;
    text: string;
    smsBody?: string | null;
    locale: string;
  },
): Promise<string> {
  const [row] = await tx
    .insert(storedContents)
    .values({
      orgId,
      subject: input.subject.slice(0, 300),
      preheader: input.preheader ?? '',
      html: input.html,
      textBody: input.text,
      smsBody: input.smsBody ?? null,
      locale: input.locale,
    })
    .returning({ id: storedContents.id });
  if (!row) throw new Error('stored content: insert failed');
  return row.id;
}

export async function storedContentTx(tx: TenantTx, id: string): Promise<StoredContent | null> {
  const [row] = await tx.select().from(storedContents).where(eq(storedContents.id, id));
  return row ?? null;
}

/** Stored content filled for one recipient: the email parts, and the text for SMS/WhatsApp. */
export function renderStoredContent(
  c: Pick<StoredContent, 'subject' | 'preheader' | 'html' | 'textBody' | 'smsBody'>,
  r: {
    name: string | null;
    email: string | null;
    orgName: string;
    unsubscribeUrl: string | null;
    origin: string;
  },
) {
  const values = {
    ...recipientValues({ name: r.name, email: r.email, orgName: r.orgName }),
    system: { unsubscribe: r.unsubscribeUrl ?? '#', origin: r.origin.replace(/\/$/, '') },
  };
  const subject = applyMerge(c.subject, values);
  const preview = applyMerge(c.preheader, values);
  return {
    subject,
    html: applyMerge(c.html, values, { html: true }),
    text: applyMerge(c.textBody, values),
    sms: c.smsBody ? applyMerge(c.smsBody, values) : null,
    preview: preview || subject,
  };
}

const likePrefix = (prefix: string) => `${prefix.replace(/[\\%_]/g, '\\$&')}%`;

/** What happened to a send's messages (campaign results, M3.6b; M3.8b reads the same). */
export async function sendOutcomesTx(
  tx: TenantTx,
  prefix: string,
): Promise<{
  queued: number;
  sent: number;
  suppressed: number;
  failed: number;
  canceled: number;
  delivered: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
}> {
  const where = sql`${messages.dedupeKey} like ${likePrefix(prefix)}`;
  const [byStatus, byDelivery, unsub] = await Promise.all([
    tx.select({ k: messages.status, n: count() }).from(messages).where(where).groupBy(messages.status),
    tx
      .select({ k: messages.delivery, n: count() })
      .from(messages)
      .where(and(where, isNotNull(messages.delivery)))
      .groupBy(messages.delivery),
    tx
      .select({ n: count() })
      .from(suppressions)
      .innerJoin(messages, eq(messages.id, suppressions.messageId))
      .where(where),
  ]);
  const s = new Map(byStatus.map((r) => [r.k, r.n]));
  const d = new Map(byDelivery.map((r) => [r.k, r.n]));
  return {
    queued: s.get('queued') ?? 0,
    sent: s.get('sent') ?? 0,
    suppressed: s.get('suppressed') ?? 0,
    failed: s.get('failed') ?? 0,
    canceled: s.get('canceled') ?? 0,
    // A complaint or bounce replaces "delivered" as the latest report; each counts where it ended.
    delivered: (d.get('delivered') ?? 0) + (d.get('complained') ?? 0),
    bounced: (d.get('bounced') ?? 0) + (d.get('soft_bounced') ?? 0),
    complained: d.get('complained') ?? 0,
    unsubscribed: unsub[0]?.n ?? 0,
  };
}

/** Cancel a send's messages still waiting in the queue (a cancelled campaign). */
export async function cancelQueuedByPrefixTx(
  tx: TenantTx,
  prefix: string,
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await tx
    .update(messages)
    .set({ status: 'canceled', reason, updatedAt: now })
    .where(and(eq(messages.status, 'queued'), sql`${messages.dedupeKey} like ${likePrefix(prefix)}`))
    .returning({ id: messages.id });
  return rows.length;
}

/**
 * Marketing reach checks for many addresses at once (a campaign's recipient snapshot): bounces
 * and complaints on the channel (`suppressed`), and unsubscribes from marketing (`unsubscribed`,
 * email only; an organizer blocked by the contact is an unsubscribe too). Keys are normalized.
 */
export async function marketingSuppressionsTx(
  tx: TenantTx,
  channel: 'email' | 'sms' | 'whatsapp',
  addresses: readonly string[],
): Promise<Map<string, 'suppressed' | 'unsubscribed'>> {
  const out = new Map<string, 'suppressed' | 'unsubscribed'>();
  const norm = [...new Set(addresses.map((a) => (channel === 'email' ? normalizeEmail(a) : a.trim())))];
  for (let i = 0; i < norm.length; i += 5_000) {
    const part = norm.slice(i, i + 5_000);
    if (channel === 'email') {
      const unsub = await tx
        .select({ a: suppressions.emailNorm })
        .from(suppressions)
        .where(and(eq(suppressions.category, 'marketing'), inArray(suppressions.emailNorm, part)));
      for (const r of unsub) out.set(r.a, 'unsubscribed');
    }
    const hard = await tx
      .select({ a: addressSuppressions.addressNorm })
      .from(addressSuppressions)
      .where(and(eq(addressSuppressions.channel, channel), inArray(addressSuppressions.addressNorm, part)));
    for (const r of hard) out.set(r.a, 'suppressed');
  }
  return out;
}

/** Messages under a dedupe-key prefix queued since a moment (test-send limits, M3.6b). */
export async function queuedSinceByPrefixTx(tx: TenantTx, prefix: string, since: Date): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(messages)
    .where(and(sql`${messages.dedupeKey} like ${likePrefix(prefix)}`, gt(messages.createdAt, since)));
  return row?.n ?? 0;
}
