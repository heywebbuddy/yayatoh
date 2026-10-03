import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { boothExhibitorsTx } from '@yayatoh/program';
import { and, desc, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { clipExcerpt, EXCERPT_MESSAGES } from '../domain/chat.ts';
import { hideProfileTx, networkSettingsTx } from '../networking/state.ts';
import {
  boothChatSettings,
  type ChatSide,
  chatConversations,
  chatMessages,
  chatReports,
  networkProfiles,
  type REPORT_REASONS,
} from '../schema.ts';
import { eventOf } from '../state.ts';
import { ChatConsoleDto, type ChatExcerptDto, type ChatReportDto } from './dto.ts';
import { boothOpen, boothSettingsTx, type ConversationRow, publishRemovedTx, refused } from './state.ts';

/**
 * Chat moderation for organizers (M5.8b). Organizers never read conversations: they see counts,
 * and for a reported conversation the report with an excerpt (the latest messages up to the
 * report). They can remove a reported message, hide the reported person (as for an M5.8a report)
 * or suspend the reported exhibitor's booth chat, or dismiss. `events:read` for the console,
 * `events:write` for actions.
 */
const Event = { eventId: z.uuid() };
const DAY = 86_400_000;

/** Who is reported on a conversation: the side that did not report. */
const reportedSide = (reporter: string): ChatSide => (reporter === 'a' ? 'b' : 'a');

/** The reported subject of a report: a person (profile) or an exhibitor. */
function subjectOf(c: ConversationRow, reporter: string) {
  const side = reportedSide(reporter);
  if (c.kind === 'direct')
    return { kind: 'person' as const, id: (side === 'a' ? c.profileA : c.profileB) ?? '' };
  return side === 'a'
    ? { kind: 'person' as const, id: c.profileA }
    : { kind: 'exhibitor' as const, id: c.exhibitorId ?? '' };
}

/** The latest messages of a conversation up to `until`, oldest first. */
export async function excerptTx(tx: TenantTx, conversationId: string, until: Date) {
  const rows = await tx
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), lte(chatMessages.createdAt, until)))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(EXCERPT_MESSAGES);
  return rows.reverse();
}

export const chatConsoleQuery = tenantQuery({
  name: 'engagement.chatConsole',
  input: z.object(Event),
  output: ChatConsoleDto,
  entitlement: 'sessions',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const s = await networkSettingsTx(tx, input.eventId);
    const [conv] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(chatConversations)
      .where(eq(chatConversations.eventId, input.eventId));
    const [today] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.eventId, input.eventId),
          gt(chatMessages.createdAt, new Date(ctx.now.getTime() - DAY)),
        ),
      );
    const reports = await tx
      .select({ r: chatReports, c: chatConversations })
      .from(chatReports)
      .innerJoin(chatConversations, eq(chatConversations.id, chatReports.conversationId))
      .where(eq(chatReports.eventId, input.eventId))
      .orderBy(sql`${chatReports.moderation} <> 'open'`, desc(chatReports.createdAt))
      .limit(200);
    const exhibitors = await boothExhibitorsTx(tx, input.eventId);
    const exhibitorName = new Map(exhibitors.map((x) => [x.id, x.name]));
    const settings = await tx
      .select()
      .from(boothChatSettings)
      .where(eq(boothChatSettings.eventId, input.eventId));
    const profileIds = [
      ...new Set(reports.flatMap(({ c }) => [c.profileA, ...(c.profileB ? [c.profileB] : [])])),
    ];
    const people = new Map(
      (profileIds.length
        ? await tx
            .select({
              id: networkProfiles.id,
              name: networkProfiles.displayName,
              hiddenAt: networkProfiles.hiddenAt,
            })
            .from(networkProfiles)
            .where(inArray(networkProfiles.id, profileIds))
        : []
      ).map((p) => [p.id, p]),
    );
    const suspended = new Set(settings.filter((x) => x.suspendedAt).map((x) => x.exhibitorId));
    const nameOfSide = (c: ConversationRow, side: ChatSide) =>
      side === 'a'
        ? (people.get(c.profileA)?.name ?? '—')
        : c.kind === 'direct'
          ? (people.get(c.profileB ?? '')?.name ?? '—')
          : (exhibitorName.get(c.exhibitorId ?? '') ?? '—');
    const out: ChatReportDto[] = [];
    for (const { r, c } of reports) {
      const subject = subjectOf(c, r.reporter);
      const reported = reportedSide(r.reporter);
      const excerpt: ChatExcerptDto[] = (await excerptTx(tx, c.id, r.createdAt)).map((m) => ({
        id: m.id,
        from: nameOfSide(c, m.sender as ChatSide),
        byReported: m.sender === reported,
        body: clipExcerpt(m.body),
        removed: m.removedAt !== null,
        at: m.createdAt,
      }));
      out.push({
        id: r.id,
        kind: c.kind as 'direct' | 'booth',
        reason: r.reason as (typeof REPORT_REASONS)[number],
        details: r.details,
        moderation: r.moderation as ChatReportDto['moderation'],
        createdAt: r.createdAt,
        reporterName: nameOfSide(c, r.reporter as ChatSide),
        reported: {
          kind: subject.kind,
          name: nameOfSide(c, reported),
          actioned:
            subject.kind === 'person' ? Boolean(people.get(subject.id)?.hiddenAt) : suspended.has(subject.id),
        },
        excerpt,
      });
    }
    let taking = 0;
    for (const x of exhibitors)
      if (boothOpen(x, settings.find((y) => y.exhibitorId === x.id) ?? null)) taking++;
    return {
      chatEnabled: s?.chatEnabled ?? true,
      stats: {
        conversations: conv?.n ?? 0,
        messagesToday: today?.n ?? 0,
        openReports: reports.filter(({ r }) => r.moderation === 'open').length,
        boothsTakingChats: taking,
      },
      reports: out,
      suspendedBooths: exhibitors.filter((x) => suspended.has(x.id)).map((x) => ({ id: x.id, name: x.name })),
    };
  },
});

async function reportTx(tx: TenantTx, eventId: string, reportId: string) {
  const [r] = await tx
    .select()
    .from(chatReports)
    .where(and(eq(chatReports.id, reportId), eq(chatReports.eventId, eventId)))
    .for('update');
  const [c] = r
    ? await tx.select().from(chatConversations).where(eq(chatConversations.id, r.conversationId))
    : [];
  if (!r || !c) throw new DomainError('not_found');
  return { r, c };
}

/**
 * Act on a chat report: `hide` the reported person (out of networking, as for an M5.8a report)
 * or suspend the reported exhibitor's booth chat; or `dismiss`. Once per report.
 */
export const moderateChatReportCommand = tenantCommand({
  name: 'engagement.moderateChatReport',
  input: z.object({ ...Event, reportId: z.uuid(), action: z.enum(['hide', 'dismiss']) }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { r, c } = await reportTx(tx, input.eventId, input.reportId);
    if (r.moderation !== 'open') throw refused('resolved');
    const by = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    if (input.action === 'hide') {
      const subject = subjectOf(c, r.reporter);
      if (subject.kind === 'person') await hideProfileTx(tx, ctx, subject.id, by);
      else
        await tx
          .insert(boothChatSettings)
          .values({
            orgId: requireOrg(ctx),
            eventId: c.eventId,
            exhibitorId: subject.id,
            suspendedAt: ctx.now,
            suspendedBy: by ?? requireOrg(ctx),
          })
          .onConflictDoUpdate({
            target: [boothChatSettings.orgId, boothChatSettings.exhibitorId],
            set: { suspendedAt: ctx.now, suspendedBy: by ?? requireOrg(ctx), updatedAt: ctx.now },
          });
    }
    await tx
      .update(chatReports)
      .set({
        moderation: input.action === 'hide' ? 'actioned' : 'dismissed',
        moderatedAt: ctx.now,
        moderatedBy: by,
        updatedAt: ctx.now,
      })
      .where(eq(chatReports.id, r.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: input.action === 'hide' ? 'engagement.chat.report_hide' : 'engagement.chat.report_dismiss',
    targetType: 'chat_report',
    targetId: input.reportId,
  }),
});

/**
 * Remove a message of a reported conversation: neither side sees its text again (their open pages
 * are told at once). Only messages of conversations someone reported; once.
 */
export const removeChatMessageCommand = tenantCommand({
  name: 'engagement.removeChatMessage',
  category: 'delete',
  input: z.object({ ...Event, messageId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [m] = await tx
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.id, input.messageId), eq(chatMessages.eventId, input.eventId)))
      .for('update');
    if (!m) throw new DomainError('not_found');
    const [reported] = await tx
      .select({ id: chatReports.id })
      .from(chatReports)
      .where(eq(chatReports.conversationId, m.conversationId))
      .limit(1);
    if (!reported) throw new DomainError('not_found');
    if (m.removedAt) throw refused('already_removed');
    const by = ctx.actor.type === 'user' ? ctx.actor.userId : requireOrg(ctx);
    await tx
      .update(chatMessages)
      .set({ removedAt: ctx.now, removedBy: by, updatedAt: ctx.now })
      .where(eq(chatMessages.id, m.id));
    const [c] = await tx.select().from(chatConversations).where(eq(chatConversations.id, m.conversationId));
    if (c) await publishRemovedTx(tx, requireOrg(ctx), c, m.id);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.chat.message_remove',
    targetType: 'chat_message',
    targetId: input.messageId,
  }),
});

/** Lift the suspension of an exhibitor's booth chat (its own switch decides again). */
export const restoreBoothChatCommand = tenantCommand({
  name: 'engagement.restoreBoothChat',
  input: z.object({ ...Event, exhibitorId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await boothSettingsTx(tx, input.exhibitorId, true);
    if (!s || s.eventId !== input.eventId || !s.suspendedAt) throw new DomainError('not_found');
    await tx
      .update(boothChatSettings)
      .set({ suspendedAt: null, suspendedBy: null, updatedAt: ctx.now })
      .where(and(eq(boothChatSettings.id, s.id), isNotNull(boothChatSettings.suspendedAt)));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.chat.booth_restore',
    targetType: 'exhibitor',
    targetId: input.exhibitorId,
  }),
});
