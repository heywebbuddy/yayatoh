import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { boothExhibitorsTx } from '@yayatoh/program';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { CHAT_MESSAGE_MAX } from '../domain/chat.ts';
import { blockTx } from '../networking/attendee.ts';
import {
  activeProfilesTx,
  blockedWithTx,
  listed,
  memberOf,
  type ProfileRow,
  personRef,
  type Viewer,
  viewerTx,
  visiblePersonTx,
} from '../networking/state.ts';
import { chatConversations, chatReports, networkProfiles, REPORT_REASONS } from '../schema.ts';
import { type BoothRefDto, ChatInboxDto, type ChatSummaryDto, ChatThreadDto } from './dto.ts';
import {
  attendeeRefusalTx,
  boothConversationTx,
  boothExhibitorTx,
  boothOpen,
  boothSettingsTx,
  type ConversationRow,
  chatAllowedTx,
  chatBody,
  createConversationTx,
  directConversationTx,
  lastMessagesTx,
  markReadTx,
  messagesTx,
  rateLimited,
  refused,
  sendTx,
  sideOfProfile,
  toMessage,
  unreadTx,
} from './state.ts';

/**
 * Networking chat as an attendee does it (M5.8b, P5-3): 1:1 with someone they are connected with
 * or have agreed a meeting with (both opted in, neither blocked), and with an exhibitor at its
 * booth. Like the rest of networking (`public:networking`), every command resolves the viewer from
 * the verified address and their active place at the event, never from an id the browser sends.
 */
const Email = z.email().max(254);
const At = { eventId: z.uuid(), email: Email };
const Body = z.string().max(CHAT_MESSAGE_MAX * 2);
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);

const toBooth = (x: { id: string; name: string; boothNumbers: readonly string[] }): BoothRefDto => ({
  id: x.id,
  name: x.name,
  boothNumbers: [...x.boothNumbers],
});

/** Chat is on for the event (the organizer's switch, with networking on). */
const chatOn = (v: Viewer) => v.settings.chatEnabled;

/** Hold both profiles of a direct chat, lowest id first (as meetings do), so blocks serialize. */
async function lockPairTx(tx: TenantTx, a: string, b: string) {
  await tx
    .select({ id: networkProfiles.id })
    .from(networkProfiles)
    .where(inArray(networkProfiles.id, [a, b]))
    .orderBy(asc(networkProfiles.id))
    // Not FOR UPDATE: a block's insert takes FOR KEY SHARE on both profiles (its FKs), which
    // FOR NO KEY UPDATE lets through, so a block and a send can't deadlock.
    .for('no key update');
}

export const chatStarted = (c: ConversationRow): DomainEvent => ({
  type: 'engagement.chat_started',
  version: 1,
  aggregateType: 'event',
  aggregateId: c.eventId,
  payload: { eventId: c.eventId, conversationId: c.id, kind: c.kind },
});

/* -------------------------------------------------------------------------------- inbox ---- */

/**
 * The attendee's chats, newest first: direct chats with people they may still see (listed, still
 * attending, no block either way) and their booth chats; plus the booths taking chats now.
 */
export const chatInboxQuery = tenantQuery({
  name: 'engagement.chatInbox',
  input: z.object(At),
  output: ChatInboxDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email);
    const me = memberOf(v);
    const rows = await tx
      .select()
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.eventId, me.eventId),
          or(eq(chatConversations.profileA, me.id), eq(chatConversations.profileB, me.id)),
        ),
      )
      .orderBy(desc(chatConversations.lastMessageAt));
    const otherIds = rows
      .filter((c) => c.kind === 'direct')
      .map((c) => (c.profileA === me.id ? c.profileB : c.profileA) ?? '');
    const blocked = await blockedWithTx(tx, me.id);
    const others = otherIds.length
      ? await tx.select().from(networkProfiles).where(inArray(networkProfiles.id, otherIds))
      : [];
    const visible = new Map(
      (
        await activeProfilesTx(
          tx,
          me.eventId,
          others.filter((p) => listed(p) && !blocked.has(p.id)),
        )
      ).map((p) => [p.id, p]),
    );
    const booths = await boothExhibitorsTx(tx, me.eventId);
    const boothById = new Map(booths.filter((b) => b.listed).map((b) => [b.id, b]));
    const shown = rows.filter((c) =>
      c.kind === 'direct'
        ? visible.has((c.profileA === me.id ? c.profileB : c.profileA) ?? '')
        : boothById.has(c.exhibitorId ?? ''),
    );
    const last = await lastMessagesTx(
      tx,
      shown.map((c) => c.id),
    );
    const unread = await unreadTx(
      tx,
      shown.map((c) => ({ conversation: c, side: sideOfProfile(c, me.id) })),
    );
    const conversations: ChatSummaryDto[] = shown.map((c) => {
      const side = sideOfProfile(c, me.id);
      const m = last.get(c.id);
      const other = c.kind === 'direct' ? visible.get((side === 'a' ? c.profileB : c.profileA) ?? '') : null;
      const booth = c.kind === 'booth' ? boothById.get(c.exhibitorId ?? '') : null;
      return {
        id: c.id,
        kind: c.kind as 'direct' | 'booth',
        person: other ? personRef(other) : null,
        booth: booth ? toBooth(booth) : null,
        last: m ? { body: m.removedAt ? null : m.body, fromMe: m.sender === side, at: m.createdAt } : null,
        unread: unread.get(c.id) ?? 0,
      };
    });
    const open = [];
    if (chatOn(v))
      for (const b of boothById.values())
        if (boothOpen(b, await boothSettingsTx(tx, b.id))) open.push(toBooth(b));
    return { chatEnabled: chatOn(v), conversations, booths: open };
  },
});

/* ------------------------------------------------------------------------- direct chat ---- */

/**
 * A direct chat with one person of the directory. `not_found` for anyone the viewer may not see
 * (not listed, left, blocked either way). `closed` says why no message may be sent now.
 */
export const chatThreadQuery = tenantQuery({
  name: 'engagement.chatThread',
  input: z.object({ ...At, personId: z.uuid() }),
  output: ChatThreadDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email);
    const me = memberOf(v);
    const other = await visiblePersonTx(tx, me, input.personId);
    const c = await directConversationTx(tx, me.id, other.id);
    const side = c ? sideOfProfile(c, me.id) : 'a';
    return {
      conversationId: c?.id ?? null,
      kind: 'direct' as const,
      person: personRef(other),
      booth: null,
      messages: c ? (await messagesTx(tx, c.id)).map((m) => toMessage(m, side)) : [],
      closed: !chatOn(v) ? 'chat_off' : (await chatAllowedTx(tx, me.id, other.id)) ? null : 'not_connected',
      blockedByMe: false,
    };
  },
});

export const SendChatInput = z.object({ ...At, personId: z.uuid(), body: Body });

/**
 * Send a message to a person. Refused unless chat is on, both are listed with no block between
 * them (`not_found`: a blocked person's messages never deliver, and the sender learns nothing
 * more than "not there"), and they have an accepted connection or an agreed meeting
 * (`forbidden` / `not_connected`). Rate limited (`rate_limited` with the limit's reason).
 */
export const sendChatMessageCommand = tenantCommand({
  name: 'engagement.sendChatMessage',
  input: SendChatInput,
  output: z.object({ conversationId: z.uuid(), messageId: z.uuid() }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx, emit }) => {
    const body = chatBody(input.body);
    const v = await viewerTx(tx, input.eventId, input.email);
    const me0 = memberOf(v);
    if (input.personId === me0.id) throw new DomainError('not_found');
    await lockPairTx(tx, me0.id, input.personId);
    // Re-read both under the locks: a block, an opt-out or a hide that just committed counts.
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    if (!chatOn(v)) throw refused('chat_off', 'Chat is off');
    const other = await visiblePersonTx(tx, me, input.personId);
    if (!(await chatAllowedTx(tx, me.id, other.id)))
      throw new DomainError('forbidden', 'Connect first', { reason: 'not_connected' });
    let c = await directConversationTx(tx, me.id, other.id, true);
    const refusal = await attendeeRefusalTx(tx, ctx, me.id, c);
    if (refusal) throw rateLimited(refusal);
    if (!c) {
      const [a, b] = me.id < other.id ? [me.id, other.id] : [other.id, me.id];
      c = await createConversationTx(tx, ctx, {
        eventId: me.eventId,
        kind: 'direct',
        profileA: a,
        profileB: b,
        startedBy: a === me.id ? 'a' : 'b',
      });
      emit(chatStarted(c));
    }
    const m = await sendTx(tx, ctx, c, sideOfProfile(c, me.id), body);
    return { conversationId: c.id, messageId: m.id };
  },
  // The text is personal: the audit keeps who and where, never what.
  audit: (input, r) => ({
    action: 'engagement.chat.send',
    targetType: 'chat_conversation',
    targetId: r?.conversationId ?? null,
    data: { kind: 'direct', personId: input.personId },
  }),
});

/* -------------------------------------------------------------------------- booth chat ---- */

async function attendeeBoothThread(tx: TenantTx, v: Viewer, me: ProfileRow, exhibitorId: string) {
  const x = await boothExhibitorTx(tx, me.eventId, exhibitorId);
  if (!x.listed) throw new DomainError('not_found');
  const c = await boothConversationTx(tx, me.id, x.id);
  const open = boothOpen(x, await boothSettingsTx(tx, x.id));
  // A booth that takes no chats and was never written to is not a chat at all.
  if (!c && !open) throw new DomainError('not_found');
  return {
    x,
    c,
    closed: !chatOn(v)
      ? ('chat_off' as const)
      : c?.blockedBy
        ? ('blocked' as const)
        : open
          ? null
          : ('booth_closed' as const),
  };
}

/** A booth chat with an exhibitor (taking chats, or written to before). */
export const boothThreadQuery = tenantQuery({
  name: 'engagement.boothThread',
  input: z.object({ ...At, exhibitorId: z.uuid() }),
  output: ChatThreadDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email);
    const me = memberOf(v);
    const { x, c, closed } = await attendeeBoothThread(tx, v, me, input.exhibitorId);
    return {
      conversationId: c?.id ?? null,
      kind: 'booth' as const,
      person: null,
      booth: toBooth(x),
      messages: c ? (await messagesTx(tx, c.id)).map((m) => toMessage(m, 'a')) : [],
      closed,
      blockedByMe: c?.blockedBy === 'a',
    };
  },
});

export const SendBoothInput = z.object({ ...At, exhibitorId: z.uuid(), body: Body });

/** Write to an exhibitor at its booth. Refused unless it takes chats and neither side blocked. */
export const sendBoothMessageCommand = tenantCommand({
  name: 'engagement.sendBoothMessage',
  input: SendBoothInput,
  output: z.object({ conversationId: z.uuid(), messageId: z.uuid() }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx, emit }) => {
    const body = chatBody(input.body);
    const v = await viewerTx(tx, input.eventId, input.email, true);
    const me = memberOf(v);
    if (!chatOn(v)) throw refused('chat_off', 'Chat is off');
    const x = await boothExhibitorTx(tx, me.eventId, input.exhibitorId);
    if (!x.listed) throw new DomainError('not_found');
    if (!boothOpen(x, await boothSettingsTx(tx, x.id, true)))
      throw refused('booth_closed', 'Booth chat is off');
    let c = await boothConversationTx(tx, me.id, x.id, true);
    if (c?.blockedBy) throw refused('blocked', 'This chat is blocked');
    const refusal = await attendeeRefusalTx(tx, ctx, me.id, c);
    if (refusal) throw rateLimited(refusal);
    if (!c) {
      c = await createConversationTx(tx, ctx, {
        eventId: me.eventId,
        kind: 'booth',
        profileA: me.id,
        exhibitorId: x.id,
        startedBy: 'a',
      });
      emit(chatStarted(c));
    }
    const m = await sendTx(tx, ctx, c, 'a', body);
    return { conversationId: c.id, messageId: m.id };
  },
  audit: (input, r) => ({
    action: 'engagement.chat.send',
    targetType: 'chat_conversation',
    targetId: r?.conversationId ?? null,
    data: { kind: 'booth', exhibitorId: input.exhibitorId },
  }),
});

/** Block or unblock a booth's chat (the attendee's side). */
export const blockBoothCommand = tenantCommand({
  name: 'engagement.blockBooth',
  input: z.object({ ...At, exhibitorId: z.uuid(), blocked: z.boolean() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email, true));
    await boothSettingsTx(tx, input.exhibitorId, true);
    const c = await boothConversationTx(tx, me.id, input.exhibitorId, true);
    if (!c) throw new DomainError('not_found');
    if (input.blocked && !c.blockedBy)
      await tx
        .update(chatConversations)
        .set({ blockedBy: 'a', blockedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(chatConversations.id, c.id));
    if (!input.blocked && c.blockedBy === 'a')
      await tx
        .update(chatConversations)
        .set({ blockedBy: null, blockedAt: null, updatedAt: ctx.now })
        .where(eq(chatConversations.id, c.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: input.blocked ? 'engagement.chat.block_booth' : 'engagement.chat.unblock_booth',
    targetType: 'exhibitor',
    targetId: input.exhibitorId,
  }),
});

/* ------------------------------------------------------------------- read, report ---- */

/** The viewer's own conversation (direct or booth) by id, or `not_found`. */
async function ownConversationTx(tx: TenantTx, me: ProfileRow, conversationId: string, lock = false) {
  const q = tx
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.eventId, me.eventId),
        or(eq(chatConversations.profileA, me.id), eq(chatConversations.profileB, me.id)),
      ),
    );
  const [c] = await (lock ? q.for('update') : q);
  if (!c) throw new DomainError('not_found');
  return c;
}

/** The attendee read a conversation up to now (the unread counts). */
export const markChatReadCommand = tenantCommand({
  name: 'engagement.markChatRead',
  input: z.object({ ...At, conversationId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    const c = await ownConversationTx(tx, me, input.conversationId);
    await markReadTx(tx, c, sideOfProfile(c, me.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.chat.read',
    targetType: 'chat_conversation',
    targetId: input.conversationId,
  }),
});

export const ReportChatInput = z.object({
  ...At,
  conversationId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: Optional(500),
});

export const chatReported = (r: {
  orgId: string;
  eventId: string;
  reportId: string;
  contactId: string | null;
  reason: string;
}): DomainEvent => ({
  type: 'engagement.chat_reported',
  version: 1,
  aggregateType: 'event',
  aggregateId: r.eventId,
  payload: r,
});

/** File a report (organizer queue + Yayatoh review) unless one from this side is still open. */
export async function fileChatReportTx(
  tx: TenantTx,
  ctx: Ctx,
  c: ConversationRow,
  v: { reporter: 'a' | 'b'; accountId?: string | null; reason: string; details: string | null },
): Promise<string | null> {
  const [r] = await tx
    .insert(chatReports)
    .values({
      orgId: requireOrg(ctx),
      eventId: c.eventId,
      conversationId: c.id,
      reporter: v.reporter,
      reporterAccountId: v.accountId ?? null,
      reason: v.reason,
      details: v.details,
    })
    .onConflictDoNothing()
    .returning({ id: chatReports.id });
  return r?.id ?? null;
}

/**
 * Report a conversation: the organizer reviews it (with an excerpt), Yayatoh staff too, and a
 * report about a person becomes a chat fraud signal. Reporting also blocks: a person (the M5.8a
 * block, cutting every tie) or a booth's chat.
 */
export const reportChatCommand = tenantCommand({
  name: 'engagement.reportChat',
  input: ReportChatInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx, emit }) => {
    if (input.reason === 'other' && !input.details)
      throw new DomainError('validation_failed', 'Invalid details', { field: 'details', reason: 'required' });
    const me0 = memberOf(await viewerTx(tx, input.eventId, input.email));
    const c0 = await ownConversationTx(tx, me0, input.conversationId);
    if (c0.kind === 'direct') await lockPairTx(tx, c0.profileA, c0.profileB ?? '');
    else {
      await viewerTx(tx, input.eventId, input.email, true);
      await boothSettingsTx(tx, c0.exhibitorId ?? '', true);
    }
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    const c = await ownConversationTx(tx, me, input.conversationId, true);
    const side = sideOfProfile(c, me.id);
    const reportId = await fileChatReportTx(tx, ctx, c, {
      reporter: side,
      reason: input.reason,
      details: input.details,
    });
    let contactId: string | null = null;
    if (c.kind === 'direct') {
      const otherId = (side === 'a' ? c.profileB : c.profileA) ?? '';
      const [other] = await tx
        .select({ contactId: networkProfiles.contactId })
        .from(networkProfiles)
        .where(eq(networkProfiles.id, otherId));
      contactId = other?.contactId ?? null;
      await blockTx(tx, ctx, me, otherId);
    } else if (!c.blockedBy)
      await tx
        .update(chatConversations)
        .set({ blockedBy: 'a', blockedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(chatConversations.id, c.id));
    if (reportId)
      emit(
        chatReported({
          orgId: requireOrg(ctx),
          eventId: c.eventId,
          reportId,
          contactId,
          reason: input.reason,
        }),
      );
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.chat.report',
    targetType: 'chat_conversation',
    targetId: input.conversationId,
    data: { reason: input.reason },
  }),
});

/** Re-exported for the stream route: the attendee's own inbox id (their profile). */
export async function chatInboxIdTx(tx: TenantTx, eventId: string, email: string): Promise<string | null> {
  try {
    const v = await viewerTx(tx, eventId, email);
    return memberOf(v).id;
  } catch {
    return null;
  }
}
