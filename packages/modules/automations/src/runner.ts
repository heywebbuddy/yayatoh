import { addAttendeeLabelsTx, eventAttendeesTx, participationAttendeesTx } from '@yayatoh/attendees';
import { admittedTicketIdsTx } from '@yayatoh/checkin';
import { contactByIdTx } from '@yayatoh/crm';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { seriesEditionsTx } from '@yayatoh/events';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  type DomainEvent,
  executeCommand,
  isDomainError,
  requireOrg,
} from '@yayatoh/kernel';
import { hasPushDeviceTx } from '@yayatoh/notifications';
import { type Notifier, tenantCommand } from '@yayatoh/platform';
import { attendeeSeatLabelsTx } from '@yayatoh/seating';
import { answeredEventSurveyTx, sendSurveyStepTx } from '@yayatoh/surveys';
import { and, asc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import { conditionHolds, factNeeded, type PersonFacts } from './domain/conditions.ts';
import { fillPlaceholders, isMessageAction, type StepCondition } from './domain/journey.ts';
import { MAX_ATTEMPTS, retryAt } from './domain/timing.ts';
import { enrollTx, eventAnchorsTx, settleRunsTx } from './lifecycle.ts';
import { journeyRuns, journeySteps, journeys, scheduledActions } from './schema.ts';

/**
 * The journey runner (M3.7a): executes due `scheduled_actions`, one per transaction. The worker
 * queues a pg-boss job per org with due work (`automations.run-due`, exclusive per org); the dev
 * drain calls the same `runDueActions`. Exactly once:
 * - a row is claimed with `FOR UPDATE SKIP LOCKED` and only while `pending`, so two runners never
 *   both do it;
 * - the step's effect (the queued message, the label, the survey invitation) and the row's new
 *   status commit together, or neither does, and a failed attempt leaves nothing behind;
 * - the message's dedupe key is the action's idempotency key, so even a row forced back to pending
 *   can never deliver twice.
 * A step that keeps failing is marked `failed` after `MAX_ATTEMPTS` and raises
 * `automations.journey_step_failed@1` (the M3.2b alert engine's "automation failures" rule).
 */

export interface RunnerDeps {
  readonly notifier: Notifier;
}

/** The failure alert (outbox): subscribe to `automations.journey_step_failed@1`. */
export const STEP_FAILED_EVENT = 'automations.journey_step_failed';
export const StepFailedPayload = z.object({
  orgId: z.uuid(),
  journeyId: z.uuid(),
  runId: z.uuid(),
  actionId: z.uuid(),
  eventId: z.uuid(),
  position: z.int(),
  action: z.string(),
  attempts: z.int(),
  error: z.string(),
});
export type StepFailedPayload = z.infer<typeof StepFailedPayload>;

const RunOutput = z.object({
  status: z.enum(['done', 'skipped', 'cancelled', 'busy']),
  outcome: z.string().nullable(),
});
type RunOutcome = z.infer<typeof RunOutput>;

async function personFactsTx(
  tx: TenantTx,
  eventId: string,
  occurrenceId: string | null,
  contactId: string,
  need: keyof PersonFacts,
): Promise<Partial<PersonFacts>> {
  const places = (await participationAttendeesTx(tx, eventId, [contactId])).filter(
    (a) => a.status === 'active',
  );
  if (need === 'checkedIn') {
    const tickets = places.flatMap((a) => (a.ticketId ? [a.ticketId] : []));
    return { checkedIn: (await admittedTicketIdsTx(tx, eventId, tickets)).size > 0 };
  }
  if (need === 'hasSeat') {
    const seats = await attendeeSeatLabelsTx(
      tx,
      eventId,
      places.map((a) => ({ attendeeId: a.id, ticketId: a.ticketId, occurrenceId })),
    );
    return { hasSeat: seats.size > 0 };
  }
  return { answeredSurvey: await answeredEventSurveyTx(tx, eventId, contactId) };
}

async function doStepTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  deps: RunnerDeps,
  a: typeof scheduledActions.$inferSelect,
  run: typeof journeyRuns.$inferSelect,
  step: typeof journeySteps.$inferSelect,
): Promise<{ status: 'done' | 'skipped'; outcome: string }> {
  const condition = step.condition as StepCondition | null;
  if (condition) {
    const facts = await personFactsTx(tx, a.eventId, run.occurrenceId, a.contactId, factNeeded(condition));
    if (!conditionHolds(condition, facts)) return { status: 'skipped', outcome: 'condition_not_met' };
  }
  if (step.action === 'label') {
    const places = (await participationAttendeesTx(tx, a.eventId, [a.contactId])).filter(
      (p) => p.status === 'active',
    );
    if (places.length === 0) return { status: 'skipped', outcome: 'not_attending' };
    const n = await addAttendeeLabelsTx(
      tx,
      ctx,
      a.eventId,
      places.map((p) => p.id),
      [step.label ?? ''],
    );
    return n > 0
      ? { status: 'done', outcome: 'label_added' }
      : { status: 'skipped', outcome: 'too_many_labels' };
  }
  if (step.action === 'survey') {
    const person = (await eventAttendeesTx(tx, a.eventId)).find((p) => p.contactId === a.contactId);
    if (!person) return { status: 'skipped', outcome: 'not_attending' };
    const r = await sendSurveyStepTx(tx, ctx, emit, a.eventId, { attendeeId: person.id });
    return r.status === 'invited'
      ? { status: 'done', outcome: 'invited' }
      : { status: 'skipped', outcome: r.reason };
  }
  if (!isMessageAction(step.action)) throw new DomainError('internal', `Unknown step action ${step.action}`);
  const person = await contactByIdTx(tx, a.contactId);
  if (!person) return { status: 'skipped', outcome: 'no_address' };
  const anchors = await eventAnchorsTx(tx, a.eventId, run.occurrenceId);
  if (!anchors) return { status: 'skipped', outcome: 'event_missing' };
  const channel = step.action;
  if ((channel === 'sms' || channel === 'whatsapp') && !person.phoneE164)
    return { status: 'skipped', outcome: 'no_phone' };
  if (channel === 'email' && !person.email) return { status: 'skipped', outcome: 'no_address' };
  if (channel === 'push' && !(await hasPushDeviceTx(tx, { email: person.email })))
    return { status: 'skipped', outcome: 'no_device' };
  const when = new Intl.DateTimeFormat(run.locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: anchors.timeZone,
  }).format(anchors.eventStart);
  const values = { name: person.name ?? '', event: anchors.eventName, when };
  const r = await deps.notifier.enqueue(tx, {
    kind: 'automations.message',
    channels: [channel],
    to: {
      email: person.email,
      phone: person.phoneE164,
      name: person.name,
      contactId: person.id,
      locale: run.locale,
      timeZone: anchors.timeZone,
    },
    params: {
      subject: fillPlaceholders(step.subject ?? '', values),
      body: fillPlaceholders(step.body ?? '', values),
      name: person.name ?? '',
      eventName: anchors.eventName,
    },
    // The action's key: a message is queued once per journey, step, event and person, ever.
    dedupeKey: a.idempotencyKey,
    eventId: a.eventId,
    occurrenceId: run.occurrenceId,
  });
  return { status: 'done', outcome: r.queued > 0 ? 'queued' : 'already_queued' };
}

/** Run one due step (system actor only). Returns `busy` when another runner holds it or it isn't due. */
export function runScheduledActionCommand(deps: RunnerDeps) {
  return tenantCommand({
    name: 'automations.runScheduledAction',
    input: z.object({ actionId: z.uuid() }),
    output: RunOutput,
    entitlement: 'marketing',
    permission: 'platform:automations.run',
    handler: async ({ input, ctx, tx, emit }): Promise<RunOutcome & { journeyId?: string }> => {
      const [a] = await tx
        .select()
        .from(scheduledActions)
        .where(
          and(
            eq(scheduledActions.id, input.actionId),
            eq(scheduledActions.status, 'pending'),
            lte(scheduledActions.dueAt, ctx.now),
          ),
        )
        .for('update', { skipLocked: true });
      if (!a) return { status: 'busy', outcome: null };
      const [run] = await tx.select().from(journeyRuns).where(eq(journeyRuns.id, a.runId));
      const [journey] = await tx.select().from(journeys).where(eq(journeys.id, a.journeyId));
      const [step] = await tx.select().from(journeySteps).where(eq(journeySteps.id, a.stepId));
      let result: { status: 'done' | 'skipped' | 'cancelled'; outcome: string };
      const anchors = run ? await eventAnchorsTx(tx, a.eventId, run.occurrenceId) : null;
      if (run?.status !== 'active') result = { status: 'cancelled', outcome: run?.reason ?? 'run_ended' };
      else if (!journey?.enabled) result = { status: 'cancelled', outcome: 'journey_disabled' };
      else if (!step) result = { status: 'skipped', outcome: 'step_removed' };
      else if (anchors?.cancelled) result = { status: 'cancelled', outcome: 'event_cancelled' };
      else result = await doStepTx(tx, ctx, emit, deps, a, run, step);
      await tx
        .update(scheduledActions)
        .set({
          status: result.status,
          outcome: result.outcome,
          attempts: a.attempts + 1,
          completedAt: ctx.now,
          updatedAt: ctx.now,
        })
        .where(eq(scheduledActions.id, a.id));
      await settleRunsTx(tx, [a.runId], ctx.now);
      return { ...result, journeyId: a.journeyId };
    },
    present: (r) => ({ status: r.status, outcome: r.outcome }),
    audit: (input, r) => ({
      action: 'automations.step.run',
      targetType: 'journey',
      targetId: r.journeyId ?? null,
      data: { actionId: input.actionId, status: r.status, outcome: r.outcome },
    }),
  });
}

/** Codes that no retry can fix: the step fails at once. */
const PERMANENT = new Set(['validation_failed', 'not_found', 'invalid_state', 'conflict', 'forbidden']);

/**
 * Record a failed attempt (the step's own transaction rolled back): try again later with backoff,
 * or, after `MAX_ATTEMPTS` or a permanent error, mark it failed and raise the failure alert.
 */
export const recordStepFailureCommand = tenantCommand({
  name: 'automations.recordStepFailure',
  input: z.object({ actionId: z.uuid(), error: z.string().max(500), permanent: z.boolean() }),
  output: z.object({ status: z.enum(['pending', 'failed', 'gone']) }),
  entitlement: null,
  permission: 'platform:automations.run',
  handler: async ({ input, ctx, tx, emit }) => {
    const [a] = await tx
      .select()
      .from(scheduledActions)
      .where(and(eq(scheduledActions.id, input.actionId), eq(scheduledActions.status, 'pending')))
      .for('update');
    if (!a) return { status: 'gone' as const, journeyId: null };
    const attempts = a.attempts + 1;
    const failed = input.permanent || attempts >= MAX_ATTEMPTS;
    await tx
      .update(scheduledActions)
      .set(
        failed
          ? {
              status: 'failed',
              attempts,
              lastError: input.error,
              outcome: 'error',
              completedAt: ctx.now,
              updatedAt: ctx.now,
            }
          : { attempts, lastError: input.error, dueAt: retryAt(attempts, ctx.now), updatedAt: ctx.now },
      )
      .where(eq(scheduledActions.id, a.id));
    if (failed) {
      emit({
        type: STEP_FAILED_EVENT,
        version: 1,
        aggregateType: 'journey',
        aggregateId: a.journeyId,
        payload: StepFailedPayload.parse({
          orgId: requireOrg(ctx),
          journeyId: a.journeyId,
          runId: a.runId,
          actionId: a.id,
          eventId: a.eventId,
          position: a.position,
          action: a.action,
          attempts,
          // A code, never the message text (it may quote data).
          error: input.error.split(':')[0]?.slice(0, 60) ?? 'error',
        }),
      });
      await settleRunsTx(tx, [a.runId], ctx.now);
    }
    return { status: failed ? ('failed' as const) : ('pending' as const), journeyId: a.journeyId };
  },
  present: (r) => ({ status: r.status }),
  audit: (input, r) => ({
    action: 'automations.step.failure',
    targetType: 'journey',
    targetId: r.journeyId,
    data: { actionId: input.actionId, status: r.status },
  }),
});

/**
 * Journeys that start at a time relative to the event (`event_time`): everyone on the event's list
 * (active attendees) is enrolled, and people added later are enrolled on the next pass. Events
 * that have ended are left alone.
 */
export const enrollEventTimeCommand = tenantCommand({
  name: 'automations.enrollEventTime',
  input: z.object({}),
  output: z.object({ enrolled: z.int() }),
  entitlement: 'marketing',
  permission: 'platform:automations.run',
  handler: async ({ ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const list = await tx
      .select()
      .from(journeys)
      .where(and(eq(journeys.enabled, true), eq(journeys.trigger, 'event_time')));
    let enrolled = 0;
    for (const j of list) {
      const eventIds = j.eventId
        ? [j.eventId]
        : (await seriesEditionsTx(tx, j.seriesId as string)).map((e) => e.eventId);
      for (const eventId of eventIds) {
        const anchors = await eventAnchorsTx(tx, eventId, null);
        if (!anchors || anchors.cancelled || anchors.eventEnd <= ctx.now) continue;
        const already = new Set(
          (
            await tx
              .select({ contactId: journeyRuns.contactId })
              .from(journeyRuns)
              .where(and(eq(journeyRuns.journeyId, j.id), eq(journeyRuns.eventId, eventId)))
          ).map((r) => r.contactId),
        );
        const people = new Set((await eventAttendeesTx(tx, eventId)).map((p) => p.contactId));
        for (const contactId of people) {
          if (already.has(contactId)) continue;
          if (await enrollTx(tx, orgId, { journey: j, eventId, contactId, triggeredAt: ctx.now }, ctx.now))
            enrolled += 1;
        }
      }
    }
    return { enrolled };
  },
  audit: (_i, r) => ({
    action: 'automations.enroll.event_time',
    targetType: 'none',
    targetId: null,
    data: { enrolled: r.enrolled },
  }),
});

export interface RunDueResult {
  enrolled: number;
  done: number;
  skipped: number;
  cancelled: number;
  retried: number;
  failed: number;
}

/**
 * One pass for one org: enroll `event_time` journeys, then run every step due at `now` (oldest
 * first, up to `limit`), each in its own transaction. Safe to run concurrently with itself.
 */
export async function runDueActions(
  orgId: string,
  deps: RunnerDeps,
  ports: CommandPorts<TenantTx>,
  opts: { now?: Date; limit?: number } = {},
): Promise<RunDueResult> {
  const now = opts.now ?? new Date();
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'automations.runner' }, now });
  const result: RunDueResult = { enrolled: 0, done: 0, skipped: 0, cancelled: 0, retried: 0, failed: 0 };
  try {
    result.enrolled = (await executeCommand(enrollEventTimeCommand, {}, ctx, ports)).enrolled;
  } catch (err) {
    if (!isDomainError(err) || err.code !== 'module_not_enabled') throw err;
    return result;
  }
  const due = await withTenant(ctx, (tx) =>
    tx
      .select({ id: scheduledActions.id })
      .from(scheduledActions)
      .where(and(eq(scheduledActions.status, 'pending'), lte(scheduledActions.dueAt, now)))
      .orderBy(asc(scheduledActions.dueAt), asc(scheduledActions.id))
      .limit(opts.limit ?? 200),
  );
  const command = runScheduledActionCommand(deps);
  for (const { id } of due) {
    try {
      const r = await executeCommand(command, { actionId: id }, ctx, ports);
      if (r.status === 'done') result.done += 1;
      else if (r.status === 'skipped') result.skipped += 1;
      else if (r.status === 'cancelled') result.cancelled += 1;
    } catch (err) {
      const code = isDomainError(err) ? err.code : 'error';
      const f = await executeCommand(
        recordStepFailureCommand,
        {
          actionId: id,
          error: `${code}: ${(err as Error).message ?? ''}`.slice(0, 500),
          permanent: PERMANENT.has(code),
        },
        ctx,
        ports,
      );
      if (f.status === 'failed') result.failed += 1;
      else if (f.status === 'pending') result.retried += 1;
    }
  }
  return result;
}
