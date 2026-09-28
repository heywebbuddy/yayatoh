import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const messagingSchema = pgSchema('messaging');

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const ANNOUNCEMENT_CHANNELS = ['email', 'push'] as const;
export const REPORT_REASONS = ['spam', 'abuse', 'other'] as const;
/** `open` until platform staff resolve (acted on) or dismiss (no action) it (M1.10d). */
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

/** An organizer's announcement to an event's attendees (the sent log). Immutable once sent. */
export const announcements = tenantTable(
  messagingSchema,
  'announcements',
  {
    eventId: uuid('event_id').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    channels: text('channels').array().notNull(),
    recipients: integer('recipients').notNull(),
    sentBy: uuid('sent_by'),
  },
  (t) => [
    index('announcements_org_event_created_idx').on(t.orgId, t.eventId, t.createdAt),
    check('announcements_subject_length', sql`length(subject) between 1 and 150`),
    check('announcements_body_length', sql`length(body) between 1 and 5000`),
    check(
      'announcements_channels_check',
      sql`channels <@ array['email', 'push']::text[] and cardinality(channels) > 0`,
    ),
  ],
);

/**
 * One conversation per org and contact email (the organizer inbox). Either side can block:
 * the organizer (`blocked_at`: the contact's messages are refused) or the contact
 * (`contact_blocked_at`: no more replies or announcements reach them).
 */
export const threads = tenantTable(
  messagingSchema,
  'threads',
  {
    contactEmailNorm: text('contact_email_norm').notNull(),
    contactEmail: text('contact_email').notNull(),
    contactName: text('contact_name'),
    lastEventId: uuid('last_event_id'),
    lastMessageAt: tsz('last_message_at').notNull().defaultNow(),
    /** The contact wrote and nobody in the org has opened the thread since. */
    unread: boolean('unread').notNull().default(false),
    blockedAt: tsz('blocked_at'),
    blockedBy: uuid('blocked_by'),
    contactBlockedAt: tsz('contact_blocked_at'),
  },
  (t) => [
    uniqueIndex('threads_org_contact_key').on(t.orgId, t.contactEmailNorm),
    index('threads_org_last_message_idx').on(t.orgId, t.lastMessageAt),
    check(
      'threads_email_norm_check',
      sql`contact_email_norm = lower(btrim(contact_email_norm)) and contact_email_norm like '%@%'`,
    ),
  ],
);

export const threadMessages = tenantTable(
  messagingSchema,
  'thread_messages',
  {
    threadId: uuid('thread_id').notNull(),
    /** `in`: from the contact; `out`: from the organizer (a reply or an announcement). */
    direction: text('direction').notNull(),
    body: text('body'),
    announcementId: uuid('announcement_id'),
    authorUserId: uuid('author_user_id'),
    eventId: uuid('event_id'),
  },
  (t) => [
    index('thread_messages_org_thread_created_idx').on(t.orgId, t.threadId, t.createdAt),
    uniqueIndex('thread_messages_org_thread_announcement_key')
      .on(t.orgId, t.threadId, t.announcementId)
      .where(sql`announcement_id is not null`),
    foreignKey({
      name: 'thread_messages_thread_fk',
      columns: [t.orgId, t.threadId],
      foreignColumns: [threads.orgId, threads.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'thread_messages_announcement_fk',
      columns: [t.orgId, t.announcementId],
      foreignColumns: [announcements.orgId, announcements.id],
    }),
    check('thread_messages_direction_check', sql`direction in ('in', 'out')`),
    check(
      'thread_messages_content_check',
      sql`(body is not null and length(body) between 1 and 5000) or announcement_id is not null`,
    ),
  ],
);

/** A report to Yayatoh about a conversation, from either side (reviewed by platform staff). */
export const reports = tenantTable(
  messagingSchema,
  'reports',
  {
    threadId: uuid('thread_id').notNull(),
    reporter: text('reporter').notNull(),
    reporterUserId: uuid('reporter_user_id'),
    reason: text('reason').notNull(),
    note: text('note'),
    status: text('status').notNull().default('open'),
    /** Staff review (apps/admin): who (the `staff:<userId>` actor), when and why. */
    reviewedBy: text('reviewed_by'),
    reviewedAt: tsz('reviewed_at'),
    reviewNote: text('review_note'),
  },
  (t) => [
    index('reports_org_thread_idx').on(t.orgId, t.threadId),
    foreignKey({
      name: 'reports_thread_fk',
      columns: [t.orgId, t.threadId],
      foreignColumns: [threads.orgId, threads.id],
    }).onDelete('cascade'),
    check('reports_reporter_check', sql`reporter in ('organizer', 'contact')`),
    check('reports_reason_check', sql`reason in ('spam', 'abuse', 'other')`),
    check('reports_status_check', sql`status in ('open', 'resolved', 'dismissed')`),
    check(
      'reports_review_check',
      sql`(status = 'open' and reviewed_at is null) or (status <> 'open' and reviewed_at is not null and reviewed_by is not null and review_note is not null)`,
    ),
    check('reports_review_note_length', sql`review_note is null or length(review_note) between 1 and 1000`),
    index('reports_open_created_idx').on(t.createdAt, t.orgId).where(sql`status = 'open'`),
    check('reports_note_length', sql`note is null or length(note) <= 1000`),
  ],
);
