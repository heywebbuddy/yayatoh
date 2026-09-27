import { eventAttendeesTx } from '@yayatoh/attendees';
import { contactUserIdsTx, normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { deliveryStatsTx, renderMessage } from '@yayatoh/notifications';
import { defineSubscriber, type Notifier, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { assertNotPausedTx, organizationBrandTx } from '@yayatoh/tenancy';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ANNOUNCEMENT_CHANNELS, announcements, threadMessages } from './schema.ts';
import { threadToken, upsertThreadTx } from './threads.ts';

export const AnnouncementInput = z.object({
  eventId: z.uuid(),
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(5000),
  channels: z.array(z.enum(ANNOUNCEMENT_CHANNELS)).min(1).max(2),
});

/** One recipient per email address among the event's active attendees. */
async function recipientsTx(tx: TenantTx, eventId: string) {
  const byEmail = new Map<string, { email: string; name: string; contactId: string }>();
  for (const a of await eventAttendeesTx(tx, eventId)) {
    if (!a.email) continue;
    const norm = normalizeEmail(a.email);
    if (!byEmail.has(norm))
      byEmail.set(norm, { email: a.email.trim(), name: a.name, contactId: a.contactId });
  }
  return byEmail;
}

async function eventOrThrow(tx: TenantTx, eventId: string) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  return ev;
}

/** The composer's preview: how many people it reaches and the email as they will see it. */
export const previewAnnouncementQuery = tenantQuery({
  name: 'messaging.previewAnnouncement',
  input: AnnouncementInput,
  output: z.object({
    recipients: z.int(),
    subject: z.string(),
    html: z.string(),
    text: z.string(),
    dir: z.enum(['ltr', 'rtl']),
  }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventOrThrow(tx, input.eventId);
    const org = await organizationBrandTx(tx, requireOrg(ctx));
    if (!org) throw new DomainError('not_found');
    const r = renderMessage({
      kind: 'messaging.announcement',
      locale: ctx.locale,
      params: { subject: input.subject, body: input.body, name: '', eventName: ev.name, replyUrl: '#reply' },
      org,
      unsubscribeUrl: '#unsubscribe',
    });
    return {
      recipients: (await recipientsTx(tx, input.eventId)).size,
      subject: r.subject,
      html: r.html,
      text: r.text,
      dir: r.dir,
    };
  },
});

/**
 * Send an announcement to everyone attending the event. Records it (the sent log) and emits
 * `announcement.sent@1`; the worker fans it out, one email (and push) per address, each with a
 * reply link into that person's conversation. Refused while staff paused messaging, and when
 * nobody would receive it.
 */
export const sendAnnouncementCommand = tenantCommand({
  name: 'messaging.sendAnnouncement',
  input: AnnouncementInput,
  output: z.object({ id: z.uuid(), recipients: z.int() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  idempotent: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await assertNotPausedTx(tx, 'pause_messaging');
    await eventOrThrow(tx, input.eventId);
    const recipients = (await recipientsTx(tx, input.eventId)).size;
    if (recipients === 0)
      throw new DomainError('invalid_state', 'Nobody to send to', { reason: 'no_recipients' });
    const [row] = await tx
      .insert(announcements)
      .values({
        orgId,
        eventId: input.eventId,
        subject: input.subject,
        body: input.body,
        channels: [...new Set(input.channels)],
        recipients,
        sentBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning({ id: announcements.id });
    if (!row) throw new DomainError('internal');
    emit({
      type: 'announcement.sent',
      version: 1,
      aggregateType: 'announcement',
      aggregateId: row.id,
      payload: { orgId, announcementId: row.id, eventId: input.eventId },
    });
    return { id: row.id, recipients };
  },
  audit: (input, r) => ({
    action: 'messaging.send_announcement',
    targetType: 'announcement',
    targetId: r.id,
    data: { eventId: input.eventId, recipients: r.recipients, channels: input.channels },
  }),
});

export const AnnouncementDto = z.object({
  id: z.uuid(),
  subject: z.string(),
  body: z.string(),
  channels: z.array(z.enum(ANNOUNCEMENT_CHANNELS)),
  recipients: z.int(),
  sentAt: z.date(),
  delivery: z.object({ sent: z.int(), pending: z.int(), notSent: z.int() }),
});

/** The event's sent log, newest first, with delivery counts from the notifications log. */
export const announcementsQuery = tenantQuery({
  name: 'messaging.announcements',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(AnnouncementDto),
  entitlement: 'messaging',
  permission: 'messages:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.eventId, input.eventId))
      .orderBy(desc(announcements.createdAt), desc(announcements.id))
      .limit(50);
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        subject: r.subject,
        body: r.body,
        channels: r.channels as (typeof ANNOUNCEMENT_CHANNELS)[number][],
        recipients: r.recipients,
        sentAt: r.createdAt,
        delivery: await deliveryStatsTx(tx, `announcement:${r.id}:`),
      })),
    );
  },
});

const SentPayload = z.object({ orgId: z.uuid(), announcementId: z.uuid(), eventId: z.uuid() });

/**
 * Fan an announcement out (worker): each address gets its conversation (created if new), the
 * announcement in its history, and one message per channel under a per-address dedupe key, so a
 * replayed event sends nothing twice. People who blocked the organizer are skipped.
 */
export function announcementMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'messaging.announcement-mailer',
    events: ['announcement.sent@1'],
    handle: async (tx, event) => {
      const p = SentPayload.parse(event.payload);
      const [a] = await tx.select().from(announcements).where(eq(announcements.id, p.announcementId));
      const ev = await findEventTx(tx, p.eventId);
      if (!a || !ev) return;
      const people = await recipientsTx(tx, p.eventId);
      const userIds = await contactUserIdsTx(
        tx,
        [...people.values()].map((x) => x.contactId),
      );
      for (const [norm, person] of people) {
        const thread = await upsertThreadTx(tx, p.orgId, person.email, person.name, p.eventId);
        if (thread.contactBlockedAt) continue;
        await tx
          .insert(threadMessages)
          .values({
            orgId: p.orgId,
            threadId: thread.id,
            direction: 'out',
            announcementId: a.id,
            eventId: p.eventId,
          })
          .onConflictDoNothing();
        await deps.notifier.enqueue(tx, {
          kind: 'messaging.announcement',
          to: {
            email: person.email,
            name: person.name,
            userId: userIds.get(person.contactId) ?? null,
            timeZone: ev.timezone,
          },
          channels: a.channels as ('email' | 'push')[],
          params: {
            subject: a.subject,
            body: a.body,
            name: person.name,
            eventName: ev.name,
            replyUrl: `${deps.appOrigin}/messages/${threadToken(thread.id)}`,
          },
          dedupeKey: `announcement:${a.id}:${norm}`,
          eventId: p.eventId,
        });
      }
    },
  });
}
