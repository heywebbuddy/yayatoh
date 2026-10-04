import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { publishRealtimeTx } from '@yayatoh/platform';
import { type BoothExhibitor, boothExhibitorsTx } from '@yayatoh/program';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  BOOTH_PER_MINUTE,
  CHAT_MESSAGE_MAX,
  CHAT_PAGE,
  type ChatRefusal,
  chatRefusal,
  directPair,
  normalizeChatBody,
  UNANSWERED_LIMIT,
} from '../domain/chat.ts';
import {
  boothChatSettings,
  type ChatSide,
  chatConversations,
  chatMessages,
  meetings,
  networkConnections,
} from '../schema.ts';
import type { ChatMessageDto, ChatWireMessageDto } from './dto.ts';
import { BOOTH_CHAT_CHANNEL, CHAT_CHANNEL } from './realtime.ts';

export type ConversationRow = typeof chatConversations.$inferSelect;
export type MessageRow = typeof chatMessages.$inferSelect;
export type BoothSettingsRow = typeof boothChatSettings.$inferSelect;

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const refused = (reason: string, message = reason) =>
  new DomainError('invalid_state', message, { reason });

/** The other side. */
export const otherSide = (s: ChatSide): ChatSide => (s === 'a' ? 'b' : 'a');

/** Which side of a direct conversation a profile is. */
export const sideOfProfile = (c: ConversationRow, profileId: string): ChatSide =>
  c.profileA === profileId ? 'a' : 'b';

export const toMessage = (m: MessageRow, mine: ChatSide): ChatMessageDto => ({
  id: m.id,
  body: m.removedAt ? null : m.body,
  fromMe: m.sender === mine,
  removed: m.removedAt !== null,
  at: m.createdAt,
});

const toWire = (conversationId: string, m: MessageRow, mine: ChatSide): ChatWireMessageDto => ({
  conversationId,
  id: m.id,
  body: m.removedAt ? null : m.body,
  fromMe: m.sender === mine,
  removed: m.removedAt !== null,
  at: m.createdAt.toISOString(),
});

/** The message text as stored, or `validation_failed` (`body`: `required` / `too_long`). */
export function chatBody(text: string): string {
  const body = normalizeChatBody(text);
  if (!body)
    throw new DomainError('validation_failed', 'Write a message', { field: 'body', reason: 'required' });
  if (body.length > CHAT_MESSAGE_MAX)
    throw new DomainError('validation_failed', 'Message too long', { field: 'body', reason: 'too_long' });
  return body;
}

/** The direct conversation of two profiles, if they have one. */
export async function directConversationTx(
  tx: TenantTx,
  me: string,
  other: string,
  lock = false,
): Promise<ConversationRow | null> {
  const [a, b] = directPair(me, other);
  const q = tx
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.kind, 'direct'),
        eq(chatConversations.profileA, a),
        eq(chatConversations.profileB, b),
      ),
    );
  const [row] = await (lock ? q.for('update') : q);
  return row ?? null;
}

/** An attendee's booth conversation with an exhibitor, if they have one. */
export async function boothConversationTx(
  tx: TenantTx,
  profileId: string,
  exhibitorId: string,
  lock = false,
): Promise<ConversationRow | null> {
  const q = tx
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.kind, 'booth'),
        eq(chatConversations.profileA, profileId),
        eq(chatConversations.exhibitorId, exhibitorId),
      ),
    );
  const [row] = await (lock ? q.for('update') : q);
  return row ?? null;
}

/**
 * P5-3: two people may chat only with an accepted connection or an agreed meeting between them
 * (any slot, held or ahead). Both must also be listed and not blocked (the caller checks that
 * with `visiblePersonTx`).
 */
export async function chatAllowedTx(tx: TenantTx, a: string, b: string): Promise<boolean> {
  const [c] = await tx
    .select({ id: networkConnections.id })
    .from(networkConnections)
    .where(
      and(
        eq(networkConnections.status, 'accepted'),
        sql`least(${networkConnections.requesterId}, ${networkConnections.addresseeId}) = least(${a}::uuid, ${b}::uuid)`,
        sql`greatest(${networkConnections.requesterId}, ${networkConnections.addresseeId}) = greatest(${a}::uuid, ${b}::uuid)`,
      ),
    )
    .limit(1);
  if (c) return true;
  const [m] = await tx
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.status, 'accepted'),
        or(
          and(eq(meetings.requesterId, a), eq(meetings.inviteeId, b)),
          and(eq(meetings.requesterId, b), eq(meetings.inviteeId, a)),
        ),
      ),
    )
    .limit(1);
  return Boolean(m);
}

export async function boothSettingsTx(
  tx: TenantTx,
  exhibitorId: string,
  lock = false,
): Promise<BoothSettingsRow | null> {
  const q = tx.select().from(boothChatSettings).where(eq(boothChatSettings.exhibitorId, exhibitorId));
  const [row] = await (lock ? q.for('update') : q);
  return row ?? null;
}

/** A booth takes chats: listed, at a booth, switched on by its admin and not suspended. */
export const boothOpen = (x: BoothExhibitor | undefined, s: BoothSettingsRow | null) =>
  Boolean(x?.listed && s?.enabled && !s.suspendedAt);

/** The exhibitor at a booth of this event (listed or not), or `not_found`. */
export async function boothExhibitorTx(tx: TenantTx, eventId: string, exhibitorId: string) {
  const x = (await boothExhibitorsTx(tx, eventId)).find((e) => e.id === exhibitorId);
  if (!x) throw new DomainError('not_found');
  return x;
}

/** The latest messages of a conversation, oldest first. */
export async function messagesTx(tx: TenantTx, conversationId: string): Promise<MessageRow[]> {
  const rows = await tx
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(CHAT_PAGE);
  return rows.reverse();
}

/** Unread messages per conversation for one side: from the other side, after its last read. */
export async function unreadTx(
  tx: TenantTx,
  rows: readonly { conversation: ConversationRow; side: ChatSide }[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const { conversation: c, side } of rows) {
    const readAt = side === 'a' ? c.aReadAt : c.bReadAt;
    if (c.lastMessageAt && readAt && c.lastMessageAt <= readAt) {
      out.set(c.id, 0);
      continue;
    }
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, c.id),
          eq(chatMessages.sender, side === 'a' ? 'b' : 'a'),
          isNull(chatMessages.removedAt),
          readAt ? gt(chatMessages.createdAt, readAt) : undefined,
        ),
      );
    out.set(c.id, n?.n ?? 0);
  }
  return out;
}

/** The latest message of each conversation. */
export async function lastMessagesTx(tx: TenantTx, ids: readonly string[]): Promise<Map<string, MessageRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .selectDistinctOn([chatMessages.conversationId])
    .from(chatMessages)
    .where(inArray(chatMessages.conversationId, [...ids]))
    .orderBy(chatMessages.conversationId, desc(chatMessages.createdAt), desc(chatMessages.id));
  return new Map(rows.map((r) => [r.conversationId, r]));
}

/** This side's messages in a row at the end of the conversation (since the other side wrote). */
async function unansweredTx(tx: TenantTx, conversationId: string, side: ChatSide): Promise<number> {
  const rows = await tx
    .select({ sender: chatMessages.sender })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(UNANSWERED_LIMIT);
  let n = 0;
  for (const r of rows) {
    if (r.sender !== side) break;
    n++;
  }
  return n;
}

/**
 * Why an attendee may not send now (rate limits, P5-3), or null. The caller holds their profile
 * row, so concurrent sends by the same person count each other.
 */
export async function attendeeRefusalTx(
  tx: TenantTx,
  ctx: Ctx,
  profileId: string,
  conversation: ConversationRow | null,
): Promise<ChatRefusal | null> {
  const since = new Date(ctx.now.getTime() - HOUR);
  const minute = new Date(ctx.now.getTime() - MINUTE);
  const [sent] = await tx
    .select({
      hour: sql<number>`count(*)::int`,
      minute: sql<number>`(count(*) filter (where ${chatMessages.createdAt} > ${minute.toISOString()}::timestamptz))::int`,
    })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .where(
      and(
        gt(chatMessages.createdAt, since),
        or(
          and(eq(chatConversations.profileA, profileId), eq(chatMessages.sender, 'a')),
          and(eq(chatConversations.profileB, profileId), eq(chatMessages.sender, 'b')),
        ),
      ),
    );
  const [started] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(chatConversations)
    .where(
      and(
        gt(chatConversations.createdAt, since),
        or(
          and(eq(chatConversations.profileA, profileId), eq(chatConversations.startedBy, 'a')),
          and(eq(chatConversations.profileB, profileId), eq(chatConversations.startedBy, 'b')),
        ),
      ),
    );
  return chatRefusal({
    lastMinute: sent?.minute ?? 0,
    lastHour: sent?.hour ?? 0,
    newChatsLastHour: started?.n ?? 0,
    startsChat: conversation === null,
    unanswered: conversation
      ? await unansweredTx(tx, conversation.id, sideOfProfile(conversation, profileId))
      : 0,
  });
}

/** Why an exhibitor's booth may not answer now, or null. The caller holds its settings row. */
export async function boothRefusalTx(
  tx: TenantTx,
  ctx: Ctx,
  exhibitorId: string,
  conversation: ConversationRow,
): Promise<ChatRefusal | null> {
  const since = new Date(ctx.now.getTime() - HOUR);
  const minute = new Date(ctx.now.getTime() - MINUTE);
  const [sent] = await tx
    .select({
      minute: sql<number>`(count(*) filter (where ${chatMessages.createdAt} > ${minute.toISOString()}::timestamptz))::int`,
    })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .where(
      and(
        gt(chatMessages.createdAt, since),
        eq(chatConversations.exhibitorId, exhibitorId),
        eq(chatMessages.sender, 'b'),
      ),
    );
  return chatRefusal({
    lastMinute: sent?.minute ?? 0,
    // A booth answers many visitors: only its per-minute limit and the unanswered rule apply.
    lastHour: 0,
    newChatsLastHour: 0,
    startsChat: false,
    unanswered: await unansweredTx(tx, conversation.id, 'b'),
    perMinute: BOOTH_PER_MINUTE,
  });
}

export const rateLimited = (reason: ChatRefusal) =>
  new DomainError('rate_limited', 'Too many messages', { reason });

/** Start a conversation (the first message's sender is `startedBy`). */
export async function createConversationTx(
  tx: TenantTx,
  ctx: Ctx,
  v: {
    eventId: string;
    kind: 'direct' | 'booth';
    profileA: string;
    profileB?: string | null;
    exhibitorId?: string | null;
    startedBy: ChatSide;
  },
): Promise<ConversationRow> {
  const [row] = await tx
    .insert(chatConversations)
    .values({
      orgId: requireOrg(ctx),
      eventId: v.eventId,
      kind: v.kind,
      profileA: v.profileA,
      profileB: v.profileB ?? null,
      exhibitorId: v.exhibitorId ?? null,
      startedBy: v.startedBy,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Both sides started at once: the other insert won; use its row.
  const existing =
    v.kind === 'direct'
      ? await directConversationTx(tx, v.profileA, v.profileB ?? '', true)
      : await boothConversationTx(tx, v.profileA, v.exhibitorId ?? '', true);
  if (!existing) throw new DomainError('internal');
  return existing;
}

/** The inboxes a conversation's messages go to, with the side each inbox reads as "me". */
function inboxes(c: ConversationRow) {
  return c.kind === 'direct'
    ? [
        { channel: CHAT_CHANNEL, inboxId: c.profileA, side: 'a' as const },
        { channel: CHAT_CHANNEL, inboxId: c.profileB ?? '', side: 'b' as const },
      ]
    : [
        { channel: CHAT_CHANNEL, inboxId: c.profileA, side: 'a' as const },
        { channel: BOOTH_CHAT_CHANNEL, inboxId: c.exhibitorId ?? '', side: 'b' as const },
      ];
}

/**
 * Store a message, move the conversation (its last message, the sender's read mark) and publish
 * it to both sides' inboxes in the same transaction: nothing is delivered unless it commits.
 */
export async function sendTx(
  tx: TenantTx,
  ctx: Ctx,
  c: ConversationRow,
  side: ChatSide,
  body: string,
  accountId: string | null = null,
): Promise<MessageRow> {
  const [m] = await tx
    .insert(chatMessages)
    .values({
      orgId: requireOrg(ctx),
      eventId: c.eventId,
      conversationId: c.id,
      sender: side,
      senderAccountId: accountId,
      body,
    })
    .returning();
  if (!m) throw new DomainError('internal');
  // Message times are the database's (the transaction's start), so order never depends on how
  // old a caller's context is; read marks follow the same clock.
  await tx
    .update(chatConversations)
    .set({
      lastMessageAt: m.createdAt,
      ...(side === 'a' ? { aReadAt: m.createdAt } : { bReadAt: m.createdAt }),
      updatedAt: ctx.now,
    })
    .where(eq(chatConversations.id, c.id));
  for (const i of inboxes(c))
    await publishRealtimeTx(tx, requireOrg(ctx), i.channel, {
      eventId: c.eventId,
      inboxId: i.inboxId,
      event: 'message',
      data: toWire(c.id, m, i.side),
    });
  return m;
}

/** Tell both inboxes a message was removed by the organizer. */
export async function publishRemovedTx(tx: TenantTx, orgId: string, c: ConversationRow, messageId: string) {
  for (const i of inboxes(c))
    await publishRealtimeTx(tx, orgId, i.channel, {
      eventId: c.eventId,
      inboxId: i.inboxId,
      event: 'removed',
      data: { conversationId: c.id, id: messageId },
    });
}

/** Mark a conversation read up to now (the database's clock, like message times) for one side. */
export async function markReadTx(tx: TenantTx, c: ConversationRow, side: ChatSide) {
  await tx
    .update(chatConversations)
    .set(side === 'a' ? { aReadAt: sql`now()` } : { bReadAt: sql`now()` })
    .where(eq(chatConversations.id, c.id));
}
