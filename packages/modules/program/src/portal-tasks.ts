import { type TenantTx, withTenant } from '@yayatoh/db';
import { livePortalAccountsTx, type PortalAccountDto, portalAccountLinkTx } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { cancelQueuedTx } from '@yayatoh/notifications';
import { defineSubscriber, emitEvents, type Notifier, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isOverdue, missingRecipients, preDueKey, preDueReminderAt } from './domain/portal.ts';
import {
  PortalTaskDto,
  RemindResultDto,
  type SpeakerPortalDto,
  SpeakerPortalDto as SpeakerPortalSchema,
  speakerPortalSerializer,
} from './portal-dto.ts';
import { portalChangeSummaries, speakerPrincipalTx } from './portal-speakers.ts';
import { rooms, sessionSpeakers, sessions, speakers, tracks } from './schema.ts';
import { portalTaskAssignees, portalTasks, TASK_KINDS } from './schema-portal.ts';
import { eventOf } from './shared.ts';

/**
 * M5.3a portal tasks: generic by subject kind (`speaker` now; M5.4 adds `exhibitor` with its own
 * commands and UI), one status row per assignee. Organizers create tasks for every speaker of an
 * event and remind exactly those who have not completed them; speakers complete theirs in the
 * portal (files go through media). Versioned outbox events feed future alert rules (M5.9a):
 * `program.speaker_task.completed@1` and `program.speaker_task.overdue@1`.
 */
export const MAX_TASKS_PER_EVENT = 50;

type TaskRow = typeof portalTasks.$inferSelect;
type AssigneeRow = typeof portalTaskAssignees.$inferSelect;

const taskEventPayload = (t: TaskRow, a: AssigneeRow) => ({
  taskId: t.id,
  assigneeId: a.id,
  eventId: t.eventId,
  subjectKind: t.subjectKind,
  subjectId: a.subjectId,
  dueAt: t.dueAt.toISOString(),
});

/** `program.speaker_task.completed@1` (once per assignee: completing twice is refused). */
export const speakerTaskCompleted = (t: TaskRow, a: AssigneeRow): DomainEvent => ({
  type: 'program.speaker_task.completed',
  version: 1,
  aggregateType: 'portal_task_assignee',
  aggregateId: a.id,
  payload: taskEventPayload(t, a),
});

/** `program.speaker_task.overdue@1` (once per assignee: `overdue_at` records it). */
export const speakerTaskOverdue = (t: TaskRow, a: AssigneeRow): DomainEvent => ({
  type: 'program.speaker_task.overdue',
  version: 1,
  aggregateType: 'portal_task_assignee',
  aggregateId: a.id,
  payload: taskEventPayload(t, a),
});

const taskAssigned = (t: TaskRow): DomainEvent => ({
  type: 'program.speaker_task.assigned',
  version: 1,
  aggregateType: 'portal_task',
  aggregateId: t.id,
  payload: { taskId: t.id, eventId: t.eventId },
});

async function taskOf(tx: TenantTx, eventId: string, taskId: string): Promise<TaskRow> {
  const [t] = await tx
    .select()
    .from(portalTasks)
    .where(and(eq(portalTasks.id, taskId), eq(portalTasks.eventId, eventId)));
  if (!t) throw new DomainError('not_found');
  return t;
}

/** Add every speaker of the event who is not yet an assignee; returns how many were added. */
async function assignSpeakersTx(tx: TenantTx, ctx: Ctx, t: TaskRow): Promise<number> {
  const all = await tx.select({ id: speakers.id }).from(speakers).where(eq(speakers.eventId, t.eventId));
  if (all.length === 0) return 0;
  const added = await tx
    .insert(portalTaskAssignees)
    .values(all.map((s) => ({ orgId: requireOrg(ctx), taskId: t.id, eventId: t.eventId, subjectId: s.id })))
    .onConflictDoNothing()
    .returning({ id: portalTaskAssignees.id });
  return added.length;
}

/** The pre-due reminder keys of some assignees (to cancel them when done or deleted). */
async function preDueKeysTx(tx: TenantTx, t: TaskRow, assignees: readonly AssigneeRow[], now: Date) {
  const accounts = await livePortalAccountsTx(
    tx,
    t.eventId,
    'speaker',
    assignees.map((a) => a.subjectId),
    now,
  );
  return assignees.flatMap((a) =>
    accounts.filter((c) => c.subjectId === a.subjectId).map((c) => preDueKey(a.id, c.id, t.dueAt)),
  );
}

/* ------------------------------------------------------------------ organizer side ---- */

export const CreatePortalTaskInput = z
  .object({
    eventId: z.uuid(),
    kind: z.enum(TASK_KINDS),
    title: z.string().trim().min(1).max(120),
    instructions: z.string().trim().max(2000).default(''),
    agreementText: z
      .string()
      .trim()
      .max(10_000)
      .nullable()
      .default(null)
      .transform((v) => (v ? v : null)),
    dueAt: z.coerce.date(),
  })
  .refine((v) => v.kind !== 'agreement' || v.agreementText !== null, {
    path: ['agreementText'],
    message: 'An agreement needs its text',
  });
export type CreatePortalTaskInput = z.input<typeof CreatePortalTaskInput>;

export const createPortalTaskCommand = tenantCommand({
  name: 'program.createPortalTask',
  input: CreatePortalTaskInput,
  output: z.object({ taskId: z.uuid(), assigned: z.number().int() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventOf(tx, input.eventId);
    if (input.dueAt.getTime() <= ctx.now.getTime())
      throw new DomainError('validation_failed', 'Due date in the past', { field: 'dueAt', reason: 'past' });
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(portalTasks)
      .where(eq(portalTasks.eventId, input.eventId));
    if ((n?.n ?? 0) >= MAX_TASKS_PER_EVENT)
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    const [t] = await tx
      .insert(portalTasks)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        subjectKind: 'speaker',
        kind: input.kind,
        title: input.title,
        instructions: input.instructions,
        agreementText: input.kind === 'agreement' ? input.agreementText : null,
        dueAt: input.dueAt,
        createdBy: ctx.actor.type === 'user' ? `user:${ctx.actor.userId}` : 'system',
      })
      .returning();
    if (!t) throw new DomainError('internal');
    const assigned = await assignSpeakersTx(tx, ctx, t);
    emit(taskAssigned(t));
    return { taskId: t.id, assigned };
  },
  audit: (input, r) => ({
    action: 'program.portal_task.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { taskId: r.taskId, kind: input.kind, assigned: r.assigned },
  }),
});

/** Speakers added after the task was created: give them the task too. */
export const assignNewSpeakersCommand = tenantCommand({
  name: 'program.assignNewSpeakers',
  input: z.object({ eventId: z.uuid(), taskId: z.uuid() }),
  output: z.object({ assigned: z.number().int() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const t = await taskOf(tx, input.eventId, input.taskId);
    const assigned = await assignSpeakersTx(tx, ctx, t);
    if (assigned > 0) emit(taskAssigned(t));
    return { assigned };
  },
  audit: (input, r) => ({
    action: 'program.portal_task.assign',
    targetType: 'event',
    targetId: input.eventId,
    data: { taskId: input.taskId, assigned: r.assigned },
  }),
});

export const deletePortalTaskCommand = tenantCommand({
  name: 'program.deletePortalTask',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), taskId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const t = await taskOf(tx, input.eventId, input.taskId);
    const open = await tx
      .select()
      .from(portalTaskAssignees)
      .where(and(eq(portalTaskAssignees.taskId, t.id), eq(portalTaskAssignees.status, 'open')));
    await cancelQueuedTx(tx, await preDueKeysTx(tx, t, open, ctx.now), 'task_deleted', ctx.now);
    await tx.delete(portalTasks).where(eq(portalTasks.id, t.id));
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.portal_task.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { taskId: input.taskId },
  }),
});

/** The organizer's task board: every task of the event with each assignee's status. */
export const portalTaskBoardQuery = tenantQuery({
  name: 'program.portalTaskBoard',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(PortalTaskDto),
  entitlement: 'speakers',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const tasks = await tx
      .select()
      .from(portalTasks)
      .where(and(eq(portalTasks.eventId, input.eventId), eq(portalTasks.subjectKind, 'speaker')))
      .orderBy(asc(portalTasks.dueAt), asc(portalTasks.title));
    if (tasks.length === 0) return [];
    const rows = await tx
      .select()
      .from(portalTaskAssignees)
      .where(
        inArray(
          portalTaskAssignees.taskId,
          tasks.map((t) => t.id),
        ),
      );
    const people = await tx
      .select({ id: speakers.id, name: speakers.name })
      .from(speakers)
      .where(eq(speakers.eventId, input.eventId));
    const accounts = await livePortalAccountsTx(
      tx,
      input.eventId,
      'speaker',
      people.map((p) => p.id),
      ctx.now,
    );
    return tasks.map((t) => ({
      ...t,
      assignees: rows
        .filter((a) => a.taskId === t.id)
        .map((a) => ({
          ...a,
          subjectName: people.find((p) => p.id === a.subjectId)?.name ?? '',
          reachable: accounts.some((c) => c.subjectId === a.subjectId),
        }))
        .sort((x, y) => x.subjectName.localeCompare(y.subjectName)),
    }));
  },
});

/**
 * "Remind whoever is missing X": queue one reminder per open assignee and live portal account,
 * through the notifications dispatcher (transactional, policy gate). Done assignees and other
 * tasks' assignees get nothing. The event carries ids only; the mailer re-checks each assignee.
 */
export const remindMissingCommand = tenantCommand({
  name: 'program.remindMissing',
  input: z.object({ eventId: z.uuid(), taskId: z.uuid() }),
  output: RemindResultDto,
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const t = await taskOf(tx, input.eventId, input.taskId);
    const rows = await tx.select().from(portalTaskAssignees).where(eq(portalTaskAssignees.taskId, t.id));
    const contacts = await livePortalAccountsTx(
      tx,
      t.eventId,
      'speaker',
      rows.map((a) => a.subjectId),
      ctx.now,
    );
    const plan = missingRecipients(
      rows.map((a) => ({ id: a.id, subjectId: a.subjectId, status: a.status as 'open' | 'done' })),
      contacts.map((c) => ({ id: c.id, subjectId: c.subjectId, email: c.email })),
    );
    const reminded = [...new Set(plan.recipients.map((r) => r.assigneeId))];
    if (reminded.length > 0) {
      await tx
        .update(portalTaskAssignees)
        .set({
          remindedAt: ctx.now,
          reminderCount: sql`${portalTaskAssignees.reminderCount} + 1`,
          updatedAt: ctx.now,
        })
        .where(inArray(portalTaskAssignees.id, reminded));
      emit({
        type: 'program.speaker_task.reminder_requested',
        version: 1,
        aggregateType: 'portal_task',
        aggregateId: t.id,
        payload: {
          taskId: t.id,
          requestId: ctx.requestId,
          recipients: plan.recipients.map((r) => ({ assigneeId: r.assigneeId, accountId: r.accountId })),
        },
      });
    }
    return { recipients: plan.recipients.length, unreachable: plan.unreachable.length };
  },
  audit: (input, r) => ({
    action: 'program.portal_task.remind',
    targetType: 'event',
    targetId: input.eventId,
    data: { taskId: input.taskId, recipients: r.recipients, unreachable: r.unreachable },
  }),
});

/* ------------------------------------------------------------------- speaker side ---- */

/** The speaker's own open assignee row of a task, or `not_found` (another speaker's too). */
async function ownAssigneeTx(tx: TenantTx, ctx: Ctx, assigneeId: string) {
  const { principal } = await speakerPrincipalTx(tx, ctx);
  const [row] = await tx
    .select({ a: portalTaskAssignees, t: portalTasks })
    .from(portalTaskAssignees)
    .innerJoin(portalTasks, eq(portalTasks.id, portalTaskAssignees.taskId))
    .where(
      and(
        eq(portalTaskAssignees.id, assigneeId),
        eq(portalTaskAssignees.eventId, principal.eventId),
        eq(portalTaskAssignees.subjectId, principal.subjectId),
        eq(portalTasks.subjectKind, 'speaker'),
      ),
    )
    .for('update');
  if (!row) throw new DomainError('not_found');
  if (row.a.status === 'done')
    throw new DomainError('invalid_state', 'Already done', { reason: 'already_done' });
  return { principal, task: row.t, assignee: row.a };
}

async function completeTx(
  tx: TenantTx,
  ctx: Ctx,
  own: Awaited<ReturnType<typeof ownAssigneeTx>>,
  file: { fileId: string; fileName: string } | null,
): Promise<DomainEvent[]> {
  const [done] = await tx
    .update(portalTaskAssignees)
    .set({
      status: 'done',
      completedAt: ctx.now,
      completedBy: own.principal.accountId,
      fileId: file?.fileId ?? null,
      fileName: file?.fileName ?? null,
      updatedAt: ctx.now,
    })
    .where(eq(portalTaskAssignees.id, own.assignee.id))
    .returning();
  if (!done) throw new DomainError('internal');
  // The scheduled pre-due reminders for this assignee stop.
  await cancelQueuedTx(tx, await preDueKeysTx(tx, own.task, [own.assignee], ctx.now), 'task_done', ctx.now);
  return [speakerTaskCompleted(own.task, done)];
}

/** Accept an agreement ("sign release") or tick off a confirmation task. */
export const completePortalTaskCommand = tenantCommand({
  name: 'program.completePortalTask',
  input: z.object({ assigneeId: z.uuid(), accept: z.literal(true) }),
  output: z.object({ done: z.boolean() }),
  entitlement: 'speakers',
  permission: 'portal:speaker',
  handler: async ({ input, ctx, tx, emit }) => {
    const own = await ownAssigneeTx(tx, ctx, input.assigneeId);
    if (own.task.kind === 'upload')
      throw new DomainError('validation_failed', 'Upload a file', { field: 'file', reason: 'no_file' });
    for (const e of await completeTx(tx, ctx, own, null)) emit(e);
    return { done: true };
  },
  audit: (input) => ({
    action: 'program.portal_task.complete',
    targetType: 'portal_task_assignee',
    targetId: input.assigneeId,
  }),
});

/**
 * Check a file answer's target before media stores it: the principal's own open `upload` task.
 * Media then calls `completeTaskWithFileTx` in the same transaction.
 */
export async function taskFileTargetTx(tx: TenantTx, ctx: Ctx, assigneeId: string): Promise<void> {
  const own = await ownAssigneeTx(tx, ctx, assigneeId);
  if (own.task.kind !== 'upload')
    throw new DomainError('validation_failed', 'This task takes no file', {
      field: 'file',
      reason: 'no_upload',
    });
}

/** Complete an `upload` task with a stored file; returns the events for the caller to emit. */
export async function completeTaskWithFileTx(
  tx: TenantTx,
  ctx: Ctx,
  a: { assigneeId: string; fileId: string; fileName: string },
): Promise<DomainEvent[]> {
  const own = await ownAssigneeTx(tx, ctx, a.assigneeId);
  if (own.task.kind !== 'upload') throw new DomainError('validation_failed', 'This task takes no file');
  return completeTx(tx, ctx, own, { fileId: a.fileId, fileName: a.fileName });
}

/** A task answer file's assignee under RLS, for the organizer's download (null if unknown). */
export async function taskFileOwnerTx(tx: TenantTx, fileId: string) {
  const [row] = await tx
    .select({ eventId: portalTaskAssignees.eventId, fileName: portalTaskAssignees.fileName })
    .from(portalTaskAssignees)
    .where(eq(portalTaskAssignees.fileId, fileId));
  return row ?? null;
}

/** Everything the speaker portal shows, for the signed-in speaker only. */
export const speakerPortalQuery = tenantQuery({
  name: 'program.speakerPortal',
  input: z.object({}),
  output: SpeakerPortalSchema,
  entitlement: 'speakers',
  permission: 'portal:speaker',
  handler: async ({ tx, ctx }): Promise<SpeakerPortalDto> => {
    const { principal, speaker } = await speakerPrincipalTx(tx, ctx);
    const ev = await eventOf(tx, principal.eventId);
    const mine = await tx
      .select({ s: sessions })
      .from(sessions)
      .innerJoin(
        sessionSpeakers,
        and(eq(sessionSpeakers.sessionId, sessions.id), eq(sessionSpeakers.speakerId, speaker.id)),
      )
      .where(eq(sessions.eventId, principal.eventId))
      .orderBy(asc(sessions.startsAt), asc(sessions.title));
    const ids = mine.map((m) => m.s.id);
    const co = ids.length
      ? await tx
          .select({ sessionId: sessionSpeakers.sessionId, name: speakers.name })
          .from(sessionSpeakers)
          .innerJoin(speakers, eq(speakers.id, sessionSpeakers.speakerId))
          .where(inArray(sessionSpeakers.sessionId, ids))
          .orderBy(asc(sessionSpeakers.position))
      : [];
    const roomRows = await tx.select().from(rooms).where(eq(rooms.eventId, principal.eventId));
    const trackRows = await tx.select().from(tracks).where(eq(tracks.eventId, principal.eventId));
    const changes = await portalChangeSummaries(tx, speaker.id);
    const taskRows = await tx
      .select({ a: portalTaskAssignees, t: portalTasks })
      .from(portalTaskAssignees)
      .innerJoin(portalTasks, eq(portalTasks.id, portalTaskAssignees.taskId))
      .where(
        and(
          eq(portalTaskAssignees.eventId, principal.eventId),
          eq(portalTaskAssignees.subjectId, speaker.id),
          eq(portalTasks.subjectKind, 'speaker'),
        ),
      )
      .orderBy(asc(portalTasks.dueAt));
    return speakerPortalSerializer.serialize({
      event: ev,
      speaker: { ...speaker, links: speaker.links as { label: string; url: string }[] },
      profileChange: changes.of('profile'),
      sessions: mine.map(({ s }) => ({
        ...s,
        room: roomRows.find((r) => r.id === s.roomId)?.name ?? null,
        track: trackRows.find((r) => r.id === s.trackId)?.name ?? null,
        coSpeakers: co.filter((c) => c.sessionId === s.id && c.name !== speaker.name).map((c) => c.name),
        change: changes.of(s.id),
      })),
      tasks: taskRows.map(({ a, t }) => ({
        assigneeId: a.id,
        kind: t.kind,
        title: t.title,
        instructions: t.instructions,
        agreementText: t.agreementText,
        dueAt: t.dueAt,
        status: a.status,
        completedAt: a.completedAt,
        fileName: a.fileName,
      })),
    });
  },
});

/* ---------------------------------------------------------- overdue (worker sweep) ---- */

/**
 * Emit `program.speaker_task.overdue@1` for every open assignee (the worker finds the orgs through
 * the SECURITY DEFINER `program.orgs_with_overdue_tasks`) past its task's due date, once:
 * `overdue_at` is set in the same transaction (a second sweep finds nothing).
 */
export async function emitOverdueTasks(orgId: string, now = new Date()): Promise<number> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'program.overdue-sweep' }, now });
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ a: portalTaskAssignees, t: portalTasks })
      .from(portalTaskAssignees)
      .innerJoin(portalTasks, eq(portalTasks.id, portalTaskAssignees.taskId))
      .where(
        and(
          eq(portalTaskAssignees.status, 'open'),
          isNull(portalTaskAssignees.overdueAt),
          lte(portalTasks.dueAt, now),
        ),
      )
      .for('update', { of: portalTaskAssignees, skipLocked: true })
      .limit(500);
    const due = rows.filter((r) => isOverdue(r.a, r.t.dueAt, now));
    if (due.length === 0) return 0;
    await tx
      .update(portalTaskAssignees)
      .set({ overdueAt: now, updatedAt: now })
      .where(
        inArray(
          portalTaskAssignees.id,
          due.map((r) => r.a.id),
        ),
      );
    await emitEvents(
      tx,
      ctx,
      due.map((r) => speakerTaskOverdue(r.t, r.a)),
    );
    return due.length;
  });
}

/* ------------------------------------------------------------------------- mailer ---- */

const RemindPayload = z.object({
  taskId: z.uuid(),
  requestId: z.string().min(1).max(100),
  recipients: z.array(z.object({ assigneeId: z.uuid(), accountId: z.uuid() })).max(2000),
});
const TaskPayload = z.object({ taskId: z.uuid(), eventId: z.uuid() });
const InvitedPayload = z.object({ accountId: z.uuid(), eventId: z.uuid(), role: z.string() });

/**
 * Task reminders (`program.task-reminder`, transactional, through the dispatcher and its policy
 * gate): the organizer's "remind whoever is missing X" and the scheduled reminder 48 hours before
 * the due date, planned when a task is assigned or a speaker is invited. Every message re-checks
 * that the assignee is still open; completing a task cancels its scheduled reminders.
 */
export function taskReminderMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'program.task-reminder-mailer',
    events: [
      'program.speaker_task.reminder_requested@1',
      'program.speaker_task.assigned@1',
      'portal.account_invited@1',
    ],
    handle: async (tx, event) => {
      const now = new Date();
      const send = async (
        t: TaskRow,
        _a: AssigneeRow,
        account: PortalAccountDto,
        dedupeKey: string,
        sendAfter: Date | null,
      ) => {
        const ev = await eventOf(tx, t.eventId);
        await deps.notifier.enqueue(tx, {
          kind: 'program.task-reminder',
          to: { email: account.email, timeZone: ev.timezone },
          params: {
            url: (await portalAccountLinkTx(tx, account.id, deps.appOrigin)) ?? deps.appOrigin,
            eventName: ev.name,
            title: t.title,
            until: t.dueAt.toISOString(),
            timeZone: ev.timezone,
          },
          dedupeKey,
          eventId: t.eventId,
          sendAfter,
        });
      };
      if (event.type === 'program.speaker_task.reminder_requested') {
        const p = RemindPayload.parse(event.payload);
        const [t] = await tx.select().from(portalTasks).where(eq(portalTasks.id, p.taskId));
        if (!t) return;
        const rows = await tx
          .select()
          .from(portalTaskAssignees)
          .where(
            and(
              eq(portalTaskAssignees.taskId, t.id),
              inArray(
                portalTaskAssignees.id,
                p.recipients.map((r) => r.assigneeId),
              ),
            ),
          );
        const accounts = await livePortalAccountsTx(
          tx,
          t.eventId,
          'speaker',
          rows.map((r) => r.subjectId),
          now,
        );
        for (const r of p.recipients) {
          const a = rows.find((x) => x.id === r.assigneeId);
          const c = accounts.find((x) => x.id === r.accountId);
          if (a?.status !== 'open' || !c || c.subjectId !== a.subjectId) continue;
          await send(t, a, c, `task-remind:${p.requestId}:${a.id}:${c.id}`, null);
        }
        return;
      }
      // Plan the scheduled pre-due reminders: for one task's assignees, or one new account's tasks.
      let pairs: { t: TaskRow; a: AssigneeRow }[];
      let onlyAccount: string | null = null;
      if (event.type === 'program.speaker_task.assigned') {
        const p = TaskPayload.parse(event.payload);
        pairs = await tx
          .select({ t: portalTasks, a: portalTaskAssignees })
          .from(portalTaskAssignees)
          .innerJoin(portalTasks, eq(portalTasks.id, portalTaskAssignees.taskId))
          .where(and(eq(portalTasks.id, p.taskId), eq(portalTaskAssignees.status, 'open')));
      } else {
        const p = InvitedPayload.parse(event.payload);
        if (p.role !== 'speaker') return;
        onlyAccount = p.accountId;
        pairs = await tx
          .select({ t: portalTasks, a: portalTaskAssignees })
          .from(portalTaskAssignees)
          .innerJoin(portalTasks, eq(portalTasks.id, portalTaskAssignees.taskId))
          .where(
            and(
              eq(portalTasks.eventId, p.eventId),
              eq(portalTasks.subjectKind, 'speaker'),
              eq(portalTaskAssignees.status, 'open'),
            ),
          );
      }
      if (pairs.length === 0) return;
      const eventId = pairs[0]?.t.eventId as string;
      const accounts = (
        await livePortalAccountsTx(
          tx,
          eventId,
          'speaker',
          pairs.map((x) => x.a.subjectId),
          now,
        )
      ).filter((c) => onlyAccount === null || c.id === onlyAccount);
      for (const { t, a } of pairs) {
        const at = preDueReminderAt(t.dueAt, now);
        if (!at) continue;
        for (const c of accounts.filter((x) => x.subjectId === a.subjectId))
          await send(t, a, c, preDueKey(a.id, c.id, t.dueAt), at);
      }
    },
  });
}
