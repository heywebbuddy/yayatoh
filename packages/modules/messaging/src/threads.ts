import { contactIdByEmailTx, normalizeEmail } from '@yayatoh/crm';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { suppressEmailTx, unsuppressEmailTx } from '@yayatoh/notifications';
import {
  defineSubscriber,
  type Notifier,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import { organizationNameTx } from '@yayatoh/tenancy';
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { announcements, REPORT_REASONS, reports, threadMessages, threads } from './schema.ts';

export const THREAD_PURPOSE = 'messaging.thread';
/** Contacts may write this many messages per hour into one conversation. */
export const CONTACT_HOURLY_LIMIT = 10;

export const threadToken = (threadId: string) => signLinkToken(THREAD_PURPOSE, threadId);

/** Reply link token → (org, thread), through a SECURITY DEFINER function (ids only). */
export async function threadRef(token: string): Promise<{ orgId: string; threadId: string } | null> {
  if (token.length > 200) return null;
  const threadId = verifyLinkToken(THREAD_PURPOSE, token);
  if (!threadId) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from messaging.thread_org(${threadId}::uuid)`),
  );
  return rows[0] ? { orgId: rows[0].org_id, threadId } : null;
}

/** The org's conversation with this address, created on first contact. */
export async function upsertThreadTx(
  tx: TenantTx,
  orgId: string,
  email: string,
  name: string | null,
  eventId: string | null,
) {
  const norm = normalizeEmail(email);
  await tx
    .insert(threads)
    .values({
      orgId,
      contactEmailNorm: norm,
      contactEmail: email.trim(),
      contactName: name,
      lastEventId: eventId,
    })
    .onConflictDoNothing();
  const [row] = await tx.select().from(threads).where(eq(threads.contactEmailNorm, norm));
  if (!row) throw new DomainError('internal', 'thread upsert failed');
  return row;
}

async function threadTx(tx: TenantTx, threadId: string) {
  const [t] = await tx.select().from(threads).where(eq(threads.id, threadId));
  if (!t) throw new DomainError('not_found', 'Conversation not found');
  return t;
}

export const MessageDto = z.object({
  id: z.uuid(),
  direction: z.enum(['in', 'out']),
  /** Announcements carry their subject. */
  subject: z.string().nullable(),
  body: z.string(),
  at: z.date(),
});
export type MessageDto = z.infer<typeof MessageDto>;

async function messagesTx(tx: TenantTx, threadId: string): Promise<MessageDto[]> {
  const rows = await tx
    .select({
      id: threadMessages.id,
      direction: threadMessages.direction,
      body: threadMessages.body,
      subject: announcements.subject,
      announcementBody: announcements.body,
      at: threadMessages.createdAt,
    })
    .from(threadMessages)
    .leftJoin(
      announcements,
      and(eq(announcements.orgId, threadMessages.orgId), eq(announcements.id, threadMessages.announcementId)),
    )
    .where(eq(threadMessages.threadId, threadId))
    .orderBy(asc(threadMessages.createdAt), asc(threadMessages.id))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction as 'in' | 'out',
    subject: r.subject,
    body: r.body ?? r.announcementBody ?? '',
    at: r.at,
  }));
}

export const ThreadSummaryDto = z.object({
  id: z.uuid(),
  contactName: z.string().nullable(),
  contactEmail: z.string(),
  lastMessageAt: z.date(),
  preview: z.string(),
  lastDirection: z.enum(['in', 'out']).nullable(),
  unread: z.boolean(),
  blocked: z.boolean(),
  contactBlocked: z.boolean(),
});

/** The organizer inbox: conversations, most recent first; `unread` = the contact wrote since. */
export const threadsQuery = tenantQuery({
  name: 'messaging.threads',
  input: z.object({ filter: z.enum(['all', 'unread', 'blocked']).default('all') }),
  output: z.array(ThreadSummaryDto),
  entitlement: 'messaging',
  permission: 'messages:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(threads)
      .where(
        input.filter === 'unread'
          ? eq(threads.unread, true)
          : input.filter === 'blocked'
            ? sql`${threads.blockedAt} is not null`
            : undefined,
      )
      .orderBy(desc(threads.lastMessageAt), desc(threads.id))
      .limit(100);
    return Promise.all(
      rows.map(async (t) => {
        const [last] = await tx
          .select({
            direction: threadMessages.direction,
            body: threadMessages.body,
            subject: announcements.subject,
          })
          .from(threadMessages)
          .leftJoin(
            announcements,
            and(
              eq(announcements.orgId, threadMessages.orgId),
              eq(announcements.id, threadMessages.announcementId),
            ),
          )
          .where(eq(threadMessages.threadId, t.id))
          .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
          .limit(1);
        const text = last?.body ?? last?.subject ?? '';
        return {
          id: t.id,
          contactName: t.contactName,
          contactEmail: t.contactEmail,
          lastMessageAt: t.lastMessageAt,
          preview: text.length > 140 ? `${text.slice(0, 139)}…` : text,
          lastDirection: (last?.direction as 'in' | 'out' | undefined) ?? null,
          unread: t.unread,
          blocked: t.blockedAt !== null,
          contactBlocked: t.contactBlockedAt !== null,
        };
      }),
    );
  },
});

export const ThreadDto = ThreadSummaryDto.omit({ preview: true, lastDirection: true }).extend({
  messages: z.array(MessageDto),
  reported: z.boolean(),
});

/** One conversation for the organizer. */
export const threadQuery = tenantQuery({
  name: 'messaging.thread',
  input: z.object({ threadId: z.uuid() }),
  output: ThreadDto,
  entitlement: 'messaging',
  permission: 'messages:read',
  handler: async ({ input, tx }) => {
    const t = await threadTx(tx, input.threadId);
    const [r] = await tx
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.threadId, t.id), eq(reports.reporter, 'organizer')));
    return {
      id: t.id,
      contactName: t.contactName,
      contactEmail: t.contactEmail,
      lastMessageAt: t.lastMessageAt,
      unread: t.unread,
      blocked: t.blockedAt !== null,
      contactBlocked: t.contactBlockedAt !== null,
      reported: (r?.n ?? 0) > 0,
      messages: await messagesTx(tx, t.id),
    };
  },
});

/** Opening a conversation clears its unread mark. */
export const markThreadReadCommand = tenantCommand({
  name: 'messaging.markThreadRead',
  input: z.object({ threadId: z.uuid() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'messaging',
  permission: 'messages:read',
  handler: async ({ input, ctx, tx }) => {
    await tx
      .update(threads)
      .set({ unread: false, updatedAt: ctx.now })
      .where(and(eq(threads.id, input.threadId), eq(threads.unread, true)));
    return { ok: true };
  },
  audit: (input) => ({ action: 'messaging.mark_read', targetType: 'thread', targetId: input.threadId }),
});

const Body = z.string().trim().min(1).max(2000);

/** The organizer replies; the worker emails the reply with a link back into the conversation. */
export const replyToThreadCommand = tenantCommand({
  name: 'messaging.replyToThread',
  input: z.object({ threadId: z.uuid(), body: Body }),
  output: z.object({ messageId: z.uuid() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const t = await threadTx(tx, input.threadId);
    if (t.contactBlockedAt)
      throw new DomainError('invalid_state', 'The contact blocked messages', {
        reason: 'blocked_by_contact',
      });
    if (t.blockedAt) throw new DomainError('invalid_state', 'Unblock to reply', { reason: 'blocked' });
    const [m] = await tx
      .insert(threadMessages)
      .values({
        orgId,
        threadId: t.id,
        direction: 'out',
        body: input.body,
        authorUserId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        eventId: t.lastEventId,
      })
      .returning({ id: threadMessages.id });
    if (!m) throw new DomainError('internal');
    await tx
      .update(threads)
      .set({ lastMessageAt: ctx.now, unread: false, updatedAt: ctx.now })
      .where(eq(threads.id, t.id));
    emit({
      type: 'thread.replied',
      version: 1,
      aggregateType: 'thread',
      aggregateId: t.id,
      payload: { orgId, threadId: t.id, messageId: m.id },
    });
    return { messageId: m.id };
  },
  audit: (input, r) => ({
    action: 'messaging.reply',
    targetType: 'thread',
    targetId: input.threadId,
    data: { messageId: r.messageId },
  }),
});

/** Block or unblock a contact: while blocked, their messages are refused. */
export const blockThreadCommand = tenantCommand({
  name: 'messaging.blockThread',
  input: z.object({ threadId: z.uuid(), blocked: z.boolean() }),
  output: z.object({ blocked: z.boolean() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    await threadTx(tx, input.threadId);
    await tx
      .update(threads)
      .set({
        blockedAt: input.blocked ? ctx.now : null,
        blockedBy: input.blocked && ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(eq(threads.id, input.threadId));
    return { blocked: input.blocked };
  },
  audit: (input) => ({
    action: input.blocked ? 'messaging.block' : 'messaging.unblock',
    targetType: 'thread',
    targetId: input.threadId,
  }),
});

/**
 * `messaging.report_filed@1` (M1.9e): a conversation was reported. Ids and enums only (never the
 * note, the messages or the address); check-in turns organizer reports into fraud signals.
 */
async function reportFiledEvent(
  tx: TenantTx,
  t: typeof threads.$inferSelect,
  reportId: string,
  reporter: 'organizer' | 'contact',
  reason: (typeof REPORT_REASONS)[number],
): Promise<DomainEvent> {
  return {
    type: 'messaging.report_filed',
    version: 1,
    aggregateType: 'thread',
    aggregateId: t.id,
    payload: {
      orgId: t.orgId,
      reportId,
      threadId: t.id,
      eventId: t.lastEventId,
      contactId: await contactIdByEmailTx(tx, t.contactEmail),
      reporter,
      reason,
    },
  };
}

const ReportInput = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(1000).optional(),
});

/** Report a conversation to Yayatoh (platform staff review it). */
export const reportThreadCommand = tenantCommand({
  name: 'messaging.reportThread',
  input: ReportInput.extend({ threadId: z.uuid() }),
  output: z.object({ reported: z.boolean() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx, emit }) => {
    const t = await threadTx(tx, input.threadId);
    const [report] = await tx
      .insert(reports)
      .values({
        orgId: requireOrg(ctx),
        threadId: input.threadId,
        reporter: 'organizer',
        reporterUserId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        reason: input.reason,
        note: input.note || null,
      })
      .returning({ id: reports.id });
    if (report) emit(await reportFiledEvent(tx, t, report.id, 'organizer', input.reason));
    return { reported: true };
  },
  audit: (input) => ({
    action: 'messaging.report',
    targetType: 'thread',
    targetId: input.threadId,
    data: { reason: input.reason, reporter: 'organizer' },
  }),
});

// Public side: the person who received an announcement or a reply, via their link.

export const PublicThreadDto = z.object({
  orgName: z.string(),
  contactName: z.string().nullable(),
  blocked: z.boolean(),
  contactBlocked: z.boolean(),
  messages: z.array(MessageDto.omit({ id: true }).extend({ key: z.string() })),
});
export type PublicThreadDto = z.infer<typeof PublicThreadDto>;

/** The conversation as the contact sees it (allowlisted: no staff names or internal ids). */
export async function publicThread(token: string): Promise<PublicThreadDto | null> {
  const ref = await threadRef(token);
  if (!ref) return null;
  const ctx = createCtx({ orgId: ref.orgId, actor: { type: 'system', name: 'messaging.public-thread' } });
  return withTenant(ctx, async (tx) => {
    const [t] = await tx.select().from(threads).where(eq(threads.id, ref.threadId));
    if (!t) return null;
    const msgs = await messagesTx(tx, t.id);
    return PublicThreadDto.parse({
      orgName: (await organizationNameTx(tx, ref.orgId)) ?? '',
      contactName: t.contactName,
      blocked: t.blockedAt !== null,
      contactBlocked: t.contactBlockedAt !== null,
      messages: msgs.map((m, i) => ({
        key: String(i),
        direction: m.direction,
        subject: m.subject,
        body: m.body,
        at: m.at,
      })),
    });
  });
}

const TokenInput = z.object({ token: z.string().min(10).max(200) });

async function threadFromToken(tx: TenantTx, token: string) {
  const threadId = verifyLinkToken(THREAD_PURPOSE, token);
  if (!threadId) throw new DomainError('not_found', 'Unknown link');
  return threadTx(tx, threadId);
}

/**
 * The contact writes to the organizer from their link. Refused when the organizer blocked the
 * conversation or the contact blocked the organizer; at most CONTACT_HOURLY_LIMIT per hour.
 */
export const contactMessageCommand = tenantCommand({
  name: 'messaging.contactMessage',
  input: TokenInput.extend({ body: Body }),
  output: z.object({ sent: z.boolean() }),
  entitlement: 'messaging',
  permission: 'public:messaging',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const t = await threadFromToken(tx, input.token);
    if (t.blockedAt) throw new DomainError('invalid_state', 'Not accepting messages', { reason: 'blocked' });
    if (t.contactBlockedAt)
      throw new DomainError('invalid_state', 'You blocked this organizer', { reason: 'you_blocked' });
    const [recent] = await tx
      .select({ n: count() })
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, t.id),
          eq(threadMessages.direction, 'in'),
          gt(threadMessages.createdAt, new Date(ctx.now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= CONTACT_HOURLY_LIMIT) throw new DomainError('rate_limited', 'Too many messages');
    const [m] = await tx
      .insert(threadMessages)
      .values({ orgId, threadId: t.id, direction: 'in', body: input.body, eventId: t.lastEventId })
      .returning({ id: threadMessages.id });
    if (!m) throw new DomainError('internal');
    await tx
      .update(threads)
      .set({ lastMessageAt: ctx.now, unread: true, updatedAt: ctx.now })
      .where(eq(threads.id, t.id));
    emit({
      type: 'thread.contact_wrote',
      version: 1,
      aggregateType: 'thread',
      aggregateId: t.id,
      payload: { orgId, threadId: t.id, messageId: m.id },
    });
    return { sent: true, threadId: t.id };
  },
  present: () => ({ sent: true }),
  audit: (_input, r) => ({ action: 'messaging.contact_message', targetType: 'thread', targetId: r.threadId }),
});

/**
 * The contact blocks (or unblocks) the organizer: no more replies, and the org's event updates
 * (announcements, guest emails) to this address stop too.
 */
export const contactBlockCommand = tenantCommand({
  name: 'messaging.contactBlock',
  input: TokenInput.extend({ blocked: z.boolean() }),
  output: z.object({ blocked: z.boolean() }),
  entitlement: 'messaging',
  permission: 'public:messaging',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const t = await threadFromToken(tx, input.token);
    await tx
      .update(threads)
      .set({ contactBlockedAt: input.blocked ? ctx.now : null, updatedAt: ctx.now })
      .where(eq(threads.id, t.id));
    if (input.blocked) await suppressEmailTx(tx, orgId, t.contactEmail, 'event_updates', 'block');
    else await unsuppressEmailTx(tx, t.contactEmail, 'event_updates');
    return { blocked: input.blocked, threadId: t.id };
  },
  present: (r) => ({ blocked: r.blocked }),
  audit: (input, r) => ({
    action: input.blocked ? 'messaging.contact_block' : 'messaging.contact_unblock',
    targetType: 'thread',
    targetId: r.threadId,
  }),
});

/** The contact reports the conversation to Yayatoh. */
export const contactReportCommand = tenantCommand({
  name: 'messaging.contactReport',
  input: TokenInput.merge(ReportInput),
  output: z.object({ reported: z.boolean() }),
  entitlement: 'messaging',
  permission: 'public:messaging',
  handler: async ({ input, ctx, tx, emit }) => {
    const t = await threadFromToken(tx, input.token);
    const [report] = await tx
      .insert(reports)
      .values({
        orgId: requireOrg(ctx),
        threadId: t.id,
        reporter: 'contact',
        reason: input.reason,
        note: input.note || null,
      })
      .returning({ id: reports.id });
    if (report) emit(await reportFiledEvent(tx, t, report.id, 'contact', input.reason));
    return { reported: true, threadId: t.id };
  },
  present: () => ({ reported: true }),
  audit: (input, r) => ({
    action: 'messaging.report',
    targetType: 'thread',
    targetId: r.threadId,
    data: { reason: input.reason, reporter: 'contact' },
  }),
});

const ThreadEvent = z.object({ orgId: z.uuid(), threadId: z.uuid(), messageId: z.uuid() });

/** Emails the organizer's reply to the contact, with the link back into the conversation. */
export function threadReplyMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'messaging.reply-mailer',
    events: ['thread.replied@1'],
    handle: async (tx, event) => {
      const p = ThreadEvent.parse(event.payload);
      const [t] = await tx.select().from(threads).where(eq(threads.id, p.threadId));
      const [m] = await tx.select().from(threadMessages).where(eq(threadMessages.id, p.messageId));
      if (!t || !m?.body || t.contactBlockedAt) return;
      const ev = t.lastEventId ? await findEventTx(tx, t.lastEventId) : null;
      await deps.notifier.enqueue(tx, {
        kind: 'messaging.reply',
        to: { email: t.contactEmail, name: t.contactName, timeZone: ev?.timezone ?? null },
        params: {
          body: m.body,
          name: t.contactName ?? '',
          replyUrl: `${deps.appOrigin}/messages/${threadToken(t.id)}`,
        },
        dedupeKey: `thread-reply:${m.id}`,
        eventId: t.lastEventId,
      });
    },
  });
}

/** Tells the org's messages team that a contact wrote (inbox, and email/push per preferences). */
export function contactWroteNotifier(deps: { notifier: Notifier }) {
  return defineSubscriber({
    name: 'messaging.contact-wrote',
    events: ['thread.contact_wrote@1'],
    handle: async (tx, event) => {
      const p = ThreadEvent.parse(event.payload);
      const [t] = await tx.select().from(threads).where(eq(threads.id, p.threadId));
      if (!t) return;
      const ev = t.lastEventId ? await findEventTx(tx, t.lastEventId) : null;
      await deps.notifier.notifyMembers(tx, {
        kind: 'messaging.contact_replied',
        params: { name: t.contactName ?? t.contactEmail, eventName: ev?.name ?? '' },
        dedupeKey: `contact-wrote:${p.messageId}`,
        href: `/messages/${t.id}`,
        eventId: t.lastEventId,
      });
    },
  });
}
