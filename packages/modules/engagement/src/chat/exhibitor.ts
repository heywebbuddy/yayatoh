import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { boothExhibitorsTx, exhibitorPrincipalTx } from '@yayatoh/program';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { CHAT_MESSAGE_MAX } from '../domain/chat.ts';
import { activeProfilesTx, listed, networkSettingsTx, openNetworkTx } from '../networking/state.ts';
import { boothChatSettings, chatConversations, networkProfiles, REPORT_REASONS } from '../schema.ts';
import { chatReported, fileChatReportTx } from './attendee.ts';
import { BoothInboxDto, BoothThreadDto, type VisitorDto } from './dto.ts';
import {
  boothOpen,
  boothRefusalTx,
  boothSettingsTx,
  type ConversationRow,
  chatBody,
  lastMessagesTx,
  markReadTx,
  messagesTx,
  rateLimited,
  refused,
  sendTx,
  toMessage,
  unreadTx,
} from './state.ts';

/**
 * Booth chat as an exhibitor's people answer it (M5.8b), in the exhibitor portal (M5.4a, portal
 * accounts of M5.3a: `portal:exhibitor`). The exhibitor's admin switches it on (off by default);
 * its admin and staff share one inbox. A visitor shows only as the networking profile they chose
 * (name, job title, company), and only while they are still listed and attending. Exhibitors
 * never start a chat: attendees write first.
 */
const toVisitor = (p: typeof networkProfiles.$inferSelect): VisitorDto => ({
  displayName: p.displayName,
  headline: p.headline,
  company: p.company,
});

/** The signed-in exhibitor person and their exhibitor (re-checked in the transaction). */
async function boothOwnerTx(tx: TenantTx, ctx: Ctx, need: 'admin' | 'any' = 'any') {
  const { principal, exhibitor } = await exhibitorPrincipalTx(tx, ctx, need);
  return { principal, exhibitor, accountId: principal.accountId };
}

/** Whether attendees can chat at all at this event (published, networking and chat on). */
async function eventChatTx(tx: TenantTx, eventId: string): Promise<boolean> {
  const s = await networkSettingsTx(tx, eventId);
  if (!s?.enabled || !s.chatEnabled) return false;
  return openNetworkTx(tx, eventId).then(
    () => true,
    () => false,
  );
}

/** Of these booth conversations, the ones whose visitor is still listed and attending. */
async function withVisitorsTx(tx: TenantTx, eventId: string, rows: readonly ConversationRow[]) {
  const ids = [...new Set(rows.map((c) => c.profileA))];
  const people = ids.length
    ? await tx.select().from(networkProfiles).where(inArray(networkProfiles.id, ids))
    : [];
  const visible = new Map((await activeProfilesTx(tx, eventId, people.filter(listed))).map((p) => [p.id, p]));
  return rows
    .filter((c) => visible.has(c.profileA))
    .map((c) => ({ c, visitor: visible.get(c.profileA) as (typeof people)[number] }));
}

/** This exhibitor's booth conversation, with a visitor still there; else `not_found`. */
async function boothChatTx(tx: TenantTx, exhibitorId: string, eventId: string, id: string, lock = false) {
  const q = tx
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, id),
        eq(chatConversations.kind, 'booth'),
        eq(chatConversations.exhibitorId, exhibitorId),
      ),
    );
  const [c] = await (lock ? q.for('update') : q);
  const [shown] = c ? await withVisitorsTx(tx, eventId, [c]) : [];
  if (!shown) throw new DomainError('not_found');
  return shown;
}

export const boothInboxQuery = tenantQuery({
  name: 'engagement.boothInbox',
  input: z.object({}),
  output: BoothInboxDto,
  entitlement: 'sessions',
  permission: 'portal:exhibitor',
  handler: async ({ ctx, tx }) => {
    const { principal, exhibitor } = await boothOwnerTx(tx, ctx);
    const eventId = principal.eventId;
    const s = await boothSettingsTx(tx, exhibitor.id);
    const x = (await boothExhibitorsTx(tx, eventId)).find((e) => e.id === exhibitor.id);
    const rows = await tx
      .select()
      .from(chatConversations)
      .where(and(eq(chatConversations.kind, 'booth'), eq(chatConversations.exhibitorId, exhibitor.id)))
      .orderBy(desc(chatConversations.lastMessageAt));
    const shown = await withVisitorsTx(tx, eventId, rows);
    const last = await lastMessagesTx(
      tx,
      shown.map(({ c }) => c.id),
    );
    const unread = await unreadTx(
      tx,
      shown.map(({ c }) => ({ conversation: c, side: 'b' as const })),
    );
    return {
      eventChat: await eventChatTx(tx, eventId),
      enabled: s?.enabled ?? false,
      suspended: Boolean(s?.suspendedAt),
      atBooth: Boolean(x?.listed),
      canManage: principal.role === 'exhibitor_admin',
      conversations: shown.map(({ c, visitor }) => {
        const m = last.get(c.id);
        return {
          id: c.id,
          visitor: toVisitor(visitor),
          last: m ? { body: m.removedAt ? null : m.body, fromMe: m.sender === 'b', at: m.createdAt } : null,
          unread: unread.get(c.id) ?? 0,
          blocked: c.blockedBy !== null,
        };
      }),
    };
  },
});

export const boothChatThreadQuery = tenantQuery({
  name: 'engagement.boothChatThread',
  input: z.object({ conversationId: z.uuid() }),
  output: BoothThreadDto,
  entitlement: 'sessions',
  permission: 'portal:exhibitor',
  handler: async ({ input, ctx, tx }) => {
    const { principal, exhibitor } = await boothOwnerTx(tx, ctx);
    const { c, visitor } = await boothChatTx(tx, exhibitor.id, principal.eventId, input.conversationId);
    const x = (await boothExhibitorsTx(tx, principal.eventId)).find((e) => e.id === exhibitor.id);
    const open = boothOpen(x, await boothSettingsTx(tx, exhibitor.id));
    return {
      id: c.id,
      visitor: toVisitor(visitor),
      messages: (await messagesTx(tx, c.id)).map((m) => toMessage(m, 'b')),
      closed: !(await eventChatTx(tx, principal.eventId))
        ? ('chat_off' as const)
        : c.blockedBy
          ? ('blocked' as const)
          : open
            ? null
            : ('booth_closed' as const),
      blockedByMe: c.blockedBy === 'b',
    };
  },
});

/** The booth answers a visitor (any of its people). */
export const replyBoothChatCommand = tenantCommand({
  name: 'engagement.replyBoothChat',
  input: z.object({ conversationId: z.uuid(), body: z.string().max(CHAT_MESSAGE_MAX * 2) }),
  output: z.object({ messageId: z.uuid() }),
  entitlement: 'sessions',
  permission: 'portal:exhibitor',
  handler: async ({ input, ctx, tx }) => {
    const body = chatBody(input.body);
    const { principal, exhibitor, accountId } = await boothOwnerTx(tx, ctx);
    const s = await boothSettingsTx(tx, exhibitor.id, true);
    // Someone else's conversation is simply not there, whatever the state of this booth.
    const { c } = await boothChatTx(tx, exhibitor.id, principal.eventId, input.conversationId, true);
    if (!(await eventChatTx(tx, principal.eventId))) throw refused('chat_off', 'Chat is off');
    const x = (await boothExhibitorsTx(tx, principal.eventId)).find((e) => e.id === exhibitor.id);
    if (!boothOpen(x, s)) throw refused('booth_closed', 'Booth chat is off');
    if (c.blockedBy) throw refused('blocked', 'This chat is blocked');
    const refusal = await boothRefusalTx(tx, ctx, exhibitor.id, c);
    if (refusal) throw rateLimited(refusal);
    const m = await sendTx(tx, ctx, c, 'b', body, accountId);
    return { messageId: m.id };
  },
  audit: (input) => ({
    action: 'engagement.chat.send',
    targetType: 'chat_conversation',
    targetId: input.conversationId,
    data: { kind: 'booth', side: 'exhibitor' },
  }),
});

export const markBoothReadCommand = tenantCommand({
  name: 'engagement.markBoothRead',
  input: z.object({ conversationId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'portal:exhibitor',
  handler: async ({ input, ctx, tx }) => {
    const { principal, exhibitor } = await boothOwnerTx(tx, ctx);
    const { c } = await boothChatTx(tx, exhibitor.id, principal.eventId, input.conversationId);
    await markReadTx(tx, c, 'b');
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.chat.read',
    targetType: 'chat_conversation',
    targetId: input.conversationId,
  }),
});

/** The exhibitor's admin switches booth chat on or off (a suspension stays the organizer's). */
export const setBoothChatCommand = tenantCommand({
  name: 'engagement.setBoothChat',
  input: z.object({ enabled: z.boolean() }),
  output: z.object({ enabled: z.boolean() }),
  entitlement: 'sessions',
  permission: 'portal:exhibitor',
  handler: async ({ input, ctx, tx }) => {
    const { principal, exhibitor } = await boothOwnerTx(tx, ctx, 'admin');
    await tx
      .insert(boothChatSettings)
      .values({
        orgId: requireOrg(ctx),
        eventId: principal.eventId,
        exhibitorId: exhibitor.id,
        enabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: [boothChatSettings.orgId, boothChatSettings.exhibitorId],
        set: { enabled: input.enabled, updatedAt: ctx.now },
      });
    return { enabled: input.enabled };
  },
  audit: (input) => ({
    action: input.enabled ? 'engagement.chat.booth_on' : 'engagement.chat.booth_off',
    targetType: 'exhibitor',
    targetId: null,
  }),
});

/** The booth blocks or unblocks a visitor (their messages stop; they see the chat is blocked). */
export const blockVisitorCommand = tenantCommand({
  name: 'engagement.blockVisitor',
  input: z.object({ conversationId: z.uuid(), blocked: z.boolean() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'portal:exhibitor',
  handler: async ({ input, ctx, tx }) => {
    const { principal, exhibitor } = await boothOwnerTx(tx, ctx);
    await boothSettingsTx(tx, exhibitor.id, true);
    const { c } = await boothChatTx(tx, exhibitor.id, principal.eventId, input.conversationId, true);
    if (input.blocked && !c.blockedBy)
      await tx
        .update(chatConversations)
        .set({ blockedBy: 'b', blockedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(chatConversations.id, c.id));
    if (!input.blocked && c.blockedBy === 'b')
      await tx
        .update(chatConversations)
        .set({ blockedBy: null, blockedAt: null, updatedAt: ctx.now })
        .where(eq(chatConversations.id, c.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: input.blocked ? 'engagement.chat.block_visitor' : 'engagement.chat.unblock_visitor',
    targetType: 'chat_conversation',
    targetId: input.conversationId,
  }),
});

/** The booth reports a visitor (and blocks them); a chat fraud signal about the person follows. */
export const reportVisitorCommand = tenantCommand({
  name: 'engagement.reportVisitor',
  input: z.object({
    conversationId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    details: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .default(null),
  }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'portal:exhibitor',
  handler: async ({ input, ctx, tx, emit }) => {
    if (input.reason === 'other' && !input.details)
      throw new DomainError('validation_failed', 'Invalid details', { field: 'details', reason: 'required' });
    const { principal, exhibitor, accountId } = await boothOwnerTx(tx, ctx);
    await boothSettingsTx(tx, exhibitor.id, true);
    const { c, visitor } = await boothChatTx(tx, exhibitor.id, principal.eventId, input.conversationId, true);
    const reportId = await fileChatReportTx(tx, ctx, c, {
      reporter: 'b',
      accountId,
      reason: input.reason,
      details: input.details,
    });
    if (!c.blockedBy)
      await tx
        .update(chatConversations)
        .set({ blockedBy: 'b', blockedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(chatConversations.id, c.id));
    if (reportId)
      emit(
        chatReported({
          orgId: requireOrg(ctx),
          eventId: c.eventId,
          reportId,
          contactId: visitor.contactId,
          reason: input.reason,
        }),
      );
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.chat.report',
    targetType: 'chat_conversation',
    targetId: input.conversationId,
    data: { reason: input.reason, side: 'exhibitor' },
  }),
});

/** The exhibitor's own inbox id for the stream route (the exhibitor), or null. */
export async function boothInboxTx(
  tx: TenantTx,
  ctx: Ctx,
): Promise<{ eventId: string; exhibitorId: string } | null> {
  try {
    const { principal, exhibitor } = await boothOwnerTx(tx, ctx);
    return { eventId: principal.eventId, exhibitorId: exhibitor.id };
  } catch {
    return null;
  }
}
