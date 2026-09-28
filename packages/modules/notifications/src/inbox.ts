import type { TenantTx } from '@yayatoh/db';
import { requireOrg, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isMessageKind, MESSAGE_KINDS } from './kinds.ts';
import { addInboxItemTx } from './notifier.ts';
import { requireUser } from './preferences.ts';
import { inboxItems, messages } from './schema.ts';

export const INBOX_PAGE = 20;

export const InboxItemDto = z.object({
  id: z.uuid(),
  kind: z.enum(MESSAGE_KINDS as [string, ...string[]]),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  href: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.date(),
});
export type InboxItemDto = z.infer<typeof InboxItemDto>;

async function unreadCountTx(tx: TenantTx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), isNull(inboxItems.readAt)));
  return row?.n ?? 0;
}

/** The signed-in member's unread count only (the bell polls this). */
export const inboxCountQuery = tenantQuery({
  name: 'notifications.inboxCount',
  input: z.object({}),
  output: z.object({ unread: z.int() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ ctx, tx }) => ({ unread: await unreadCountTx(tx, requireUser(ctx)) }),
});

/**
 * The signed-in member's inbox, newest first, with keyset paging (`before` = the last item's
 * id). Only their own items: the user id comes from the session, never from input.
 */
export const inboxQuery = tenantQuery({
  name: 'notifications.inbox',
  input: z.object({
    limit: z.int().min(1).max(50).default(INBOX_PAGE),
    before: z.uuid().optional(),
    unreadOnly: z.boolean().default(false),
  }),
  output: z.object({ unread: z.int(), items: z.array(InboxItemDto), more: z.boolean() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const userId = requireUser(ctx);
    const rows = await tx
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          input.unreadOnly ? isNull(inboxItems.readAt) : undefined,
          input.before ? lt(inboxItems.id, input.before) : undefined,
        ),
      )
      .orderBy(desc(inboxItems.id))
      .limit(input.limit + 1);
    return {
      unread: await unreadCountTx(tx, userId),
      more: rows.length > input.limit,
      items: rows
        .slice(0, input.limit)
        .filter((r) => isMessageKind(r.kind))
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          params: r.params as Record<string, string | number>,
          href: r.href,
          read: r.readAt !== null,
          createdAt: r.createdAt,
        })),
    };
  },
});

/** Mark some (ids) or all of the member's own items read. Items of other users are untouched. */
export const markInboxReadCommand = tenantCommand({
  name: 'notifications.markInboxRead',
  input: z.union([z.object({ ids: z.array(z.uuid()).min(1).max(100) }), z.object({ all: z.literal(true) })]),
  output: z.object({ marked: z.int(), unread: z.int() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const userId = requireUser(ctx);
    const rows = await tx
      .update(inboxItems)
      .set({ readAt: ctx.now, updatedAt: ctx.now })
      .where(
        and(
          eq(inboxItems.userId, userId),
          isNull(inboxItems.readAt),
          'ids' in input ? inArray(inboxItems.id, input.ids) : undefined,
        ),
      )
      .returning({ id: inboxItems.id });
    return { marked: rows.length, unread: await unreadCountTx(tx, userId) };
  },
  audit: (_input, r) => ({
    action: 'notifications.mark_read',
    targetType: 'inbox',
    targetId: null,
    data: { marked: r.marked },
  }),
});

/** "Send me a test notification" from the preferences page: an inbox item for the caller. */
export const sendTestNotificationCommand = tenantCommand({
  name: 'notifications.sendTest',
  input: z.object({}),
  output: z.object({ queued: z.int() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ ctx, tx }) => {
    const userId = requireUser(ctx);
    const queued = await addInboxItemTx(tx, {
      orgId: requireOrg(ctx),
      userId,
      kind: 'notifications.test',
      params: {},
      dedupeKey: `test:${uuidv7()}`,
      href: '/notifications/preferences',
    });
    return { queued };
  },
});

export const MessageLogDto = z.object({
  id: z.uuid(),
  kind: z.enum(MESSAGE_KINDS as [string, ...string[]]),
  channel: z.enum(['email', 'sms', 'push']),
  status: z.enum(['queued', 'scheduled', 'sent', 'suppressed', 'failed', 'canceled']),
  reason: z.string().nullable(),
  /** The provider's latest delivery report (M1.10d), for sent messages. */
  delivery: z.enum(['delivered', 'bounced', 'soft_bounced', 'complained']).nullable(),
  recipient: z.string().nullable(),
  subject: z.string().nullable(),
  at: z.date(),
});
export type MessageLogDto = z.infer<typeof MessageLogDto>;

const toLog = (now: Date) => (r: typeof messages.$inferSelect) => ({
  id: r.id,
  kind: r.kind,
  channel: r.channel as 'email' | 'sms' | 'push',
  status:
    r.status === 'queued' && r.sendAfter.getTime() > now.getTime()
      ? ('scheduled' as const)
      : (r.status as 'queued' | 'sent' | 'suppressed' | 'failed' | 'canceled'),
  reason: r.reason,
  delivery: (r.delivery as 'delivered' | 'bounced' | 'soft_bounced' | 'complained' | null) ?? null,
  recipient: r.recipientEmail,
  subject: r.subject,
  at: r.status === 'sent' && r.sentAt ? r.sentAt : r.status === 'queued' ? r.sendAfter : r.updatedAt,
});

/** The per-order message log for the organizer's order page: every customer message about it. */
export const orderMessagesQuery = tenantQuery({
  name: 'notifications.orderMessages',
  input: z.object({ orderId: z.uuid() }),
  output: z.array(MessageLogDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.orderId, input.orderId), sql`${messages.recipientEmail} is not null`))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(100);
    return rows.map(toLog(ctx.now));
  },
});

export const BuyerMessageDto = MessageLogDto.pick({
  id: true,
  kind: true,
  status: true,
  subject: true,
  at: true,
});

/**
 * "Emails sent" on the buyer's own order page: emails to the buyer's address about this order.
 * Called inside the order module's tenant transaction after the manage token was verified.
 */
export async function buyerOrderMessagesTx(
  tx: TenantTx,
  orderId: string,
  buyerEmail: string,
  now = new Date(),
): Promise<z.infer<typeof BuyerMessageDto>[]> {
  const rows = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.orderId, orderId),
        eq(messages.channel, 'email'),
        sql`lower(btrim(${messages.recipientEmail})) = ${buyerEmail.trim().toLowerCase()}`,
        or(eq(messages.status, 'sent'), eq(messages.status, 'queued')),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(50);
  return rows.map(toLog(now)).map((r) => BuyerMessageDto.parse(r));
}

export const DeliveryStatsDto = z.object({
  sent: z.int(),
  pending: z.int(),
  notSent: z.int(),
});

/** Delivery counts for messages whose dedupe key starts with `prefix` (an announcement's log). */
export async function deliveryStatsTx(
  tx: TenantTx,
  prefix: string,
): Promise<z.infer<typeof DeliveryStatsDto>> {
  const rows = await tx
    .select({ status: messages.status, n: count() })
    .from(messages)
    .where(sql`${messages.dedupeKey} like ${`${prefix.replace(/[\\%_]/g, '\\$&')}%`}`)
    .groupBy(messages.status);
  const by = new Map(rows.map((r) => [r.status, r.n]));
  return {
    sent: by.get('sent') ?? 0,
    pending: by.get('queued') ?? 0,
    notSent: (by.get('suppressed') ?? 0) + (by.get('failed') ?? 0) + (by.get('canceled') ?? 0),
  };
}
