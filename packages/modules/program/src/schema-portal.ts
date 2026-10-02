import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { programSchema, sessions, speakers } from './schema.ts';

/**
 * M5.3a speaker portal. Speakers propose changes to their profile, photo and session details;
 * the organizer approves or rejects them (the public agenda only ever reads the approved rows in
 * `speakers` and `sessions`). Tasks ("upload slides", "sign release") are generic by subject kind
 * (speaker now, exhibitor in M5.4) with one status row per assignee. Each table points at
 * `events.events` with a composite (org_id, event_id) key, hand-written in the migration.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const CHANGE_STATUSES = ['pending', 'approved', 'rejected', 'superseded'] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const TASK_SUBJECT_KINDS = ['speaker', 'exhibitor'] as const;
export type TaskSubjectKind = (typeof TASK_SUBJECT_KINDS)[number];
/** `upload`: answer with a file; `agreement`: read and accept a text (a release); `confirm`: tick it off. */
export const TASK_KINDS = ['upload', 'agreement', 'confirm'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const ASSIGNEE_STATUSES = ['open', 'done'] as const;

/**
 * A proposed change: to the speaker's profile (`session_id` null; may carry a photo) or to one of
 * their sessions (title, description). `base` keeps the approved values at proposal time so the
 * organizer sees a diff; at most one pending change per speaker and target (a new one supersedes).
 */
export const speakerChanges = tenantTable(
  programSchema,
  'speaker_changes',
  {
    eventId: uuid('event_id').notNull(),
    speakerId: uuid('speaker_id').notNull(),
    sessionId: uuid('session_id'),
    status: text('status').notNull().default('pending'),
    proposed: jsonb('proposed').notNull(),
    base: jsonb('base').notNull(),
    /** A proposed photo (media.portal_files, a higher tier: no FK); applied by media on approval. */
    photoFileId: uuid('photo_file_id'),
    /** The portal account that proposed it. */
    submittedBy: uuid('submitted_by').notNull(),
    decidedAt: ts('decided_at'),
    decidedBy: text('decided_by'),
    note: text('note'),
  },
  (t) => [
    index('speaker_changes_org_event_status_idx').on(t.orgId, t.eventId, t.status, t.createdAt),
    uniqueIndex('speaker_changes_org_pending_key')
      .on(t.orgId, t.speakerId, sql`coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`status = 'pending'`),
    foreignKey({
      name: 'speaker_changes_speaker_fk',
      columns: [t.orgId, t.speakerId],
      foreignColumns: [speakers.orgId, speakers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'speaker_changes_session_fk',
      columns: [t.orgId, t.sessionId],
      foreignColumns: [sessions.orgId, sessions.id],
    }).onDelete('cascade'),
    check('speaker_changes_status_check', inList('status', CHANGE_STATUSES)),
    check('speaker_changes_note_length_check', sql`note is null or char_length(note) <= 500`),
  ],
);

export const portalTasks = tenantTable(
  programSchema,
  'portal_tasks',
  {
    eventId: uuid('event_id').notNull(),
    subjectKind: text('subject_kind').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    instructions: text('instructions').notNull().default(''),
    /** The text an `agreement` task asks to accept (the speaker release: placeholder, legal-copy). */
    agreementText: text('agreement_text'),
    dueAt: ts('due_at').notNull(),
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    index('portal_tasks_org_event_due_idx').on(t.orgId, t.eventId, t.subjectKind, t.dueAt),
    check('portal_tasks_subject_kind_check', inList('subject_kind', TASK_SUBJECT_KINDS)),
    check('portal_tasks_kind_check', inList('kind', TASK_KINDS)),
    check('portal_tasks_title_length_check', sql`char_length(title) between 1 and 120`),
    check('portal_tasks_instructions_length_check', sql`char_length(instructions) <= 2000`),
    check(
      'portal_tasks_agreement_check',
      sql`(kind <> 'agreement' or agreement_text is not null) and (agreement_text is null or char_length(agreement_text) between 1 and 10000)`,
    ),
  ],
);

/** One subject's status on a task. */
export const portalTaskAssignees = tenantTable(
  programSchema,
  'portal_task_assignees',
  {
    taskId: uuid('task_id').notNull(),
    eventId: uuid('event_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    status: text('status').notNull().default('open'),
    completedAt: ts('completed_at'),
    /** The portal account that completed it. */
    completedBy: uuid('completed_by'),
    /** An `upload` answer (media.portal_files: no FK, a higher tier) and its display name. */
    fileId: uuid('file_id'),
    fileName: text('file_name'),
    remindedAt: ts('reminded_at'),
    reminderCount: integer('reminder_count').notNull().default(0),
    /** Set once `program.speaker_task.overdue@1` is emitted for this assignee. */
    overdueAt: ts('overdue_at'),
  },
  (t) => [
    uniqueIndex('portal_task_assignees_org_task_subject_key').on(t.orgId, t.taskId, t.subjectId),
    index('portal_task_assignees_org_subject_idx').on(t.orgId, t.eventId, t.subjectId),
    index('portal_task_assignees_org_open_idx').on(t.orgId, t.status, t.overdueAt),
    foreignKey({
      name: 'portal_task_assignees_task_fk',
      columns: [t.orgId, t.taskId],
      foreignColumns: [portalTasks.orgId, portalTasks.id],
    }).onDelete('cascade'),
    check('portal_task_assignees_status_check', inList('status', ASSIGNEE_STATUSES)),
    check('portal_task_assignees_done_check', sql`(status = 'done') = (completed_at is not null)`),
    check(
      'portal_task_assignees_file_name_check',
      sql`file_name is null or char_length(file_name) between 1 and 200`,
    ),
  ],
);
