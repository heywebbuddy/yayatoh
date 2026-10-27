import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CHAT_MESSAGE_MAX,
  CHAT_PER_HOUR,
  CHAT_PER_MINUTE,
  chatRefusal,
  clipExcerpt,
  EXCERPT_MESSAGES,
} from '../domain/chat.ts';
import { blockTx } from '../networking/attendee.ts';
import { blockedWithTx, hideProfileTx, memberOf, networkSettingsTx, viewerTx } from '../networking/state.ts';
import {
  CHAT_MODERATION_STATES,
  lobbyMessages,
  lobbyReads,
  lobbyReports,
  networkProfiles,
  networkSettings,
  REPORT_REASONS,
} from '../schema.ts';
import { eventOf } from '../state.ts';
import { chatBody, rateLimited, refused } from './state.ts';

/**
 * The event lobby (an event-wide chat room): every attendee who opted into networking can read
 * and write, when the organizer switched it on (it is off by default). It follows the 1:1 chat's
 * rules: the same limits (per minute and per hour), the same text normalization, reporting (which
 * also blocks the author for the reporter), organizer moderation (remove the message, hide the
 * person, or dismiss), and the 24-month retention. As in the rest of networking, every command
 * resolves the viewer from the verified address, never from an id the browser sends.
 */
export const LOBBY_PAGE = 100;

const Email = z.email().max(254);
const At = { eventId: z.uuid(), email: Email };

export const LobbyMessageDto = z.object({
  id: z.uuid(),
  /** The author as the profile they chose to show. */
  author: z.object({ displayName: z.string(), headline: z.string().nullable() }),
  mine: z.boolean(),
  /** Null once an organizer removed the message. */
  body: z.string().nullable(),
  removed: z.boolean(),
  at: z.date(),
});
export type LobbyMessageDto = z.infer<typeof LobbyMessageDto>;

export const LobbyDto = z.object({
  /** The organizer switched the lobby on (with networking and chat on). */
  enabled: z.boolean(),
  messages: z.array(LobbyMessageDto),
  unread: z.int().min(0),
});
export type LobbyDto = z.infer<typeof LobbyDto>;

const lobbyOn = (s: { chatEnabled: boolean; lobbyEnabled: boolean }) => s.chatEnabled && s.lobbyEnabled;

/* ------------------------------------------------------------------------------ attendee ---- */

/** The latest lobby messages (oldest first), without people the viewer blocked or hidden people. */
export async function lobbyMessagesTx(tx: TenantTx, eventId: string, me: string) {
  const blocked = await blockedWithTx(tx, me);
  const rows = await tx
    .select({ m: lobbyMessages, p: networkProfiles })
    .from(lobbyMessages)
    .innerJoin(networkProfiles, eq(networkProfiles.id, lobbyMessages.profileId))
    .where(eq(lobbyMessages.eventId, eventId))
    .orderBy(desc(lobbyMessages.createdAt), desc(lobbyMessages.id))
    .limit(LOBBY_PAGE);
  return rows
    .filter(({ p }) => p.id === me || (!blocked.has(p.id) && p.optedIn && p.hiddenAt === null))
    .reverse()
    .map(
      ({ m, p }): LobbyMessageDto => ({
        id: m.id,
        author: { displayName: p.displayName, headline: p.headline },
        mine: p.id === me,
        body: m.removedAt ? null : m.body,
        removed: m.removedAt !== null,
        at: m.createdAt,
      }),
    );
}

/** Messages from other people since the viewer last opened the lobby. */
export async function lobbyUnreadTx(tx: TenantTx, eventId: string, me: string): Promise<number> {
  const [read] = await tx.select().from(lobbyReads).where(eq(lobbyReads.profileId, me));
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(lobbyMessages)
    .where(
      and(
        eq(lobbyMessages.eventId, eventId),
        isNull(lobbyMessages.removedAt),
        sql`${lobbyMessages.profileId} <> ${me}`,
        read ? gt(lobbyMessages.createdAt, read.readAt) : undefined,
      ),
    );
  return row?.n ?? 0;
}

export const lobbyQuery = tenantQuery({
  name: 'engagement.lobby',
  input: z.object(At),
  output: LobbyDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email);
    const me = memberOf(v);
    if (!lobbyOn(v.settings)) return { enabled: false, messages: [], unread: 0 };
    return {
      enabled: true,
      messages: await lobbyMessagesTx(tx, input.eventId, me.id),
      unread: await lobbyUnreadTx(tx, input.eventId, me.id),
    };
  },
});

/** Messages this profile sent in the last minute and hour (the lobby's rate limits). */
async function lobbyRefusalTx(tx: TenantTx, ctx: Ctx, profileId: string) {
  const hourAgo = new Date(ctx.now.getTime() - 3_600_000);
  const minuteAgo = new Date(ctx.now.getTime() - 60_000);
  const [sent] = await tx
    .select({
      hour: sql<number>`count(*)::int`,
      minute: sql<number>`(count(*) filter (where ${lobbyMessages.createdAt} > ${minuteAgo.toISOString()}::timestamptz))::int`,
    })
    .from(lobbyMessages)
    .where(and(eq(lobbyMessages.profileId, profileId), gt(lobbyMessages.createdAt, hourAgo)));
  return chatRefusal({
    lastMinute: Math.min(sent?.minute ?? 0, CHAT_PER_MINUTE),
    lastHour: Math.min(sent?.hour ?? 0, CHAT_PER_HOUR),
    newChatsLastHour: 0,
    startsChat: false,
    unanswered: 0,
  });
}

export const sendLobbyMessageCommand = tenantCommand({
  name: 'engagement.sendLobbyMessage',
  input: z.object({ ...At, body: z.string().max(CHAT_MESSAGE_MAX * 2) }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    // The viewer's profile row is held, so concurrent sends by one person count each other.
    const v = await viewerTx(tx, input.eventId, input.email, true);
    const me = memberOf(v);
    if (!lobbyOn(v.settings)) throw refused('lobby_off');
    const body = chatBody(input.body);
    const refusal = await lobbyRefusalTx(tx, ctx, me.id);
    if (refusal) throw rateLimited(refusal);
    const [row] = await tx
      .insert(lobbyMessages)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, profileId: me.id, body })
      .returning({ id: lobbyMessages.id });
    if (!row) throw new DomainError('internal');
    return { id: row.id };
  },
  audit: (input) => ({ action: 'engagement.lobby.send', targetType: 'event', targetId: input.eventId }),
});

export const markLobbyReadCommand = tenantCommand({
  name: 'engagement.markLobbyRead',
  input: z.object(At),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email);
    const me = memberOf(v);
    await tx
      .insert(lobbyReads)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, profileId: me.id, readAt: ctx.now })
      .onConflictDoUpdate({
        target: [lobbyReads.orgId, lobbyReads.profileId],
        set: { readAt: ctx.now, updatedAt: ctx.now },
      });
    return { ok: true as const };
  },
});

/** Report a lobby message. Reporting also blocks its author for the reporter. */
export const reportLobbyMessageCommand = tenantCommand({
  name: 'engagement.reportLobbyMessage',
  input: z.object({
    ...At,
    messageId: z.uuid(),
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
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email, true);
    const me = memberOf(v);
    const [m] = await tx
      .select()
      .from(lobbyMessages)
      .where(and(eq(lobbyMessages.id, input.messageId), eq(lobbyMessages.eventId, input.eventId)));
    if (!m || m.profileId === me.id) throw new DomainError('not_found');
    const inserted = await tx
      .insert(lobbyReports)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        messageId: m.id,
        reporterId: me.id,
        reason: input.reason,
        details: input.details,
      })
      .onConflictDoNothing()
      .returning({ id: lobbyReports.id });
    if (inserted.length === 0) throw refused('already_reported');
    await blockTx(tx, ctx, me, m.profileId);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.lobby.report',
    targetType: 'lobby_message',
    targetId: input.messageId,
    data: { reason: input.reason },
  }),
});

/* ------------------------------------------------------------------------------ organizer ---- */

export const LobbyReportDto = z.object({
  id: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().nullable(),
  moderation: z.enum(CHAT_MODERATION_STATES),
  createdAt: z.date(),
  reporterName: z.string(),
  author: z.object({ name: z.string(), hidden: z.boolean() }),
  messageId: z.uuid(),
  /** The reported message and the ones just before it, clipped. */
  excerpt: z.array(
    z.object({
      id: z.uuid(),
      from: z.string(),
      reported: z.boolean(),
      body: z.string(),
      removed: z.boolean(),
    }),
  ),
});
export type LobbyReportDto = z.infer<typeof LobbyReportDto>;

export const LobbyConsoleDto = z.object({
  enabled: z.boolean(),
  /** Networking and chat are on, so the lobby can be used when enabled. */
  available: z.boolean(),
  stats: z.object({ messages: z.int().min(0), messagesToday: z.int().min(0), openReports: z.int().min(0) }),
  reports: z.array(LobbyReportDto),
});
export type LobbyConsoleDto = z.infer<typeof LobbyConsoleDto>;

export const lobbyConsoleQuery = tenantQuery({
  name: 'engagement.lobbyConsole',
  input: z.object({ eventId: z.uuid() }),
  output: LobbyConsoleDto,
  entitlement: 'sessions',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const s = await networkSettingsTx(tx, input.eventId);
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(lobbyMessages)
      .where(eq(lobbyMessages.eventId, input.eventId));
    const [today] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(lobbyMessages)
      .where(
        and(
          eq(lobbyMessages.eventId, input.eventId),
          gt(lobbyMessages.createdAt, new Date(ctx.now.getTime() - 86_400_000)),
        ),
      );
    const rows = await tx
      .select({ r: lobbyReports, m: lobbyMessages })
      .from(lobbyReports)
      .innerJoin(lobbyMessages, eq(lobbyMessages.id, lobbyReports.messageId))
      .where(eq(lobbyReports.eventId, input.eventId))
      .orderBy(sql`${lobbyReports.moderation} <> 'open'`, desc(lobbyReports.createdAt))
      .limit(100);
    const ids = [...new Set(rows.flatMap(({ r, m }) => [r.reporterId, m.profileId]))];
    const people = new Map(
      (ids.length ? await tx.select().from(networkProfiles).where(inArray(networkProfiles.id, ids)) : []).map(
        (p) => [p.id, p],
      ),
    );
    const reports: LobbyReportDto[] = [];
    for (const { r, m } of rows) {
      const context = (
        await tx
          .select({ m: lobbyMessages, name: networkProfiles.displayName })
          .from(lobbyMessages)
          .innerJoin(networkProfiles, eq(networkProfiles.id, lobbyMessages.profileId))
          .where(and(eq(lobbyMessages.eventId, input.eventId), lte(lobbyMessages.createdAt, m.createdAt)))
          .orderBy(desc(lobbyMessages.createdAt), desc(lobbyMessages.id))
          .limit(EXCERPT_MESSAGES)
      ).reverse();
      const author = people.get(m.profileId);
      reports.push({
        id: r.id,
        reason: r.reason as (typeof REPORT_REASONS)[number],
        details: r.details,
        moderation: r.moderation as (typeof CHAT_MODERATION_STATES)[number],
        createdAt: r.createdAt,
        reporterName: people.get(r.reporterId)?.displayName ?? '—',
        author: { name: author?.displayName ?? '—', hidden: Boolean(author?.hiddenAt) },
        messageId: m.id,
        excerpt: context.map(({ m: x, name }) => ({
          id: x.id,
          from: name,
          reported: x.id === m.id,
          body: x.removedAt ? '' : clipExcerpt(x.body),
          removed: x.removedAt !== null,
        })),
      });
    }
    return {
      enabled: s?.lobbyEnabled ?? false,
      available: Boolean(s?.enabled && s.chatEnabled),
      stats: {
        messages: total?.n ?? 0,
        messagesToday: today?.n ?? 0,
        openReports: reports.filter((x) => x.moderation === 'open').length,
      },
      reports,
    };
  },
});

/** Turn the lobby on or off for an event (off by default). */
export const setLobbyEnabledCommand = tenantCommand({
  name: 'engagement.setLobbyEnabled',
  input: z.object({ eventId: z.uuid(), enabled: z.boolean() }),
  output: z.object({ enabled: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const [row] = await tx
      .insert(networkSettings)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, lobbyEnabled: input.enabled })
      .onConflictDoUpdate({
        target: [networkSettings.orgId, networkSettings.eventId],
        set: { lobbyEnabled: input.enabled, updatedAt: ctx.now },
      })
      .returning({ enabled: networkSettings.lobbyEnabled });
    if (!row) throw new DomainError('internal');
    return { enabled: row.enabled };
  },
  audit: (input) => ({
    action: 'engagement.lobby.settings',
    targetType: 'event',
    targetId: input.eventId,
    data: { enabled: input.enabled },
  }),
});

/**
 * Act on a lobby report: `remove` the message (nobody sees its text again), `hide` the author (out
 * of networking, as for any report; their messages go too) or `dismiss`. Once per report.
 */
export const moderateLobbyReportCommand = tenantCommand({
  name: 'engagement.moderateLobbyReport',
  input: z.object({ eventId: z.uuid(), reportId: z.uuid(), action: z.enum(['remove', 'hide', 'dismiss']) }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [r] = await tx
      .select()
      .from(lobbyReports)
      .where(and(eq(lobbyReports.id, input.reportId), eq(lobbyReports.eventId, input.eventId)))
      .for('update');
    if (!r) throw new DomainError('not_found');
    if (r.moderation !== 'open') throw refused('resolved');
    const [m] = await tx.select().from(lobbyMessages).where(eq(lobbyMessages.id, r.messageId));
    if (!m) throw new DomainError('not_found');
    const by = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    if (input.action !== 'dismiss') {
      const removal = { removedAt: ctx.now, removedBy: by ?? requireOrg(ctx), updatedAt: ctx.now };
      if (input.action === 'hide') {
        await hideProfileTx(tx, ctx, m.profileId, by);
        await tx
          .update(lobbyMessages)
          .set(removal)
          .where(and(eq(lobbyMessages.profileId, m.profileId), isNull(lobbyMessages.removedAt)));
      } else if (!m.removedAt) {
        await tx.update(lobbyMessages).set(removal).where(eq(lobbyMessages.id, m.id));
      }
    }
    await tx
      .update(lobbyReports)
      .set({
        moderation: input.action === 'dismiss' ? 'dismissed' : 'actioned',
        moderatedAt: ctx.now,
        moderatedBy: by,
        updatedAt: ctx.now,
      })
      .where(eq(lobbyReports.id, r.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: `engagement.lobby.report_${input.action}`,
    targetType: 'lobby_report',
    targetId: input.reportId,
  }),
});

/** D11 retention: lobby messages (and their reports) of events that ended more than 24 months ago. */
export async function purgeLobbyOfEventsTx(tx: TenantTx, eventIds: readonly string[]): Promise<number> {
  if (eventIds.length === 0) return 0;
  const gone = await tx
    .delete(lobbyMessages)
    .where(inArray(lobbyMessages.eventId, [...eventIds]))
    .returning({ id: lobbyMessages.id });
  await tx.delete(lobbyReads).where(inArray(lobbyReads.eventId, [...eventIds]));
  return gone.length;
}

export async function lobbyEventIdsTx(tx: TenantTx): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: lobbyMessages.eventId })
    .from(lobbyMessages)
    .orderBy(asc(lobbyMessages.eventId));
  return rows.map((r) => r.id);
}
