import { defineSerializer } from '@yayatoh/contracts';
import { contactIdsMatchingTx, contactsByIdsTx } from '@yayatoh/crm';
import { isForeignKeyViolation, type TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  JOURNEY_TRIGGERS,
  JourneyName,
  STEP_ACTIONS,
  STEP_CONDITIONS,
  type Step,
  StepsInput,
  stepProblems,
  WAIT_ANCHORS,
} from './domain/journey.ts';
import { TEMPLATE_KEYS } from './domain/templates.ts';
import { cancelRunsTx } from './lifecycle.ts';
import {
  ACTION_STATUSES,
  journeyRuns,
  journeySteps,
  journeys,
  RUN_STATUSES,
  scheduledActions,
} from './schema.ts';

// ---------------------------------------------------------------------------------------------
// DTOs (allowlists)

export const StepDto = z.object({
  id: z.uuid(),
  position: z.int(),
  anchor: z.enum(WAIT_ANCHORS),
  offsetDays: z.int(),
  offsetMinutes: z.int(),
  atTime: z.string().nullable(),
  action: z.enum(STEP_ACTIONS),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  label: z.string().nullable(),
  condition: z.enum(STEP_CONDITIONS).nullable(),
});
export type StepDto = z.infer<typeof StepDto>;

const Counts = z.object(
  Object.fromEntries(ACTION_STATUSES.map((s) => [s, z.int()])) as Record<
    (typeof ACTION_STATUSES)[number],
    z.ZodInt
  >,
);
export type ActionCounts = z.infer<typeof Counts>;

export const JourneySummaryDto = z.object({
  id: z.uuid(),
  name: z.string(),
  eventId: z.uuid().nullable(),
  eventName: z.string().nullable(),
  seriesId: z.uuid().nullable(),
  trigger: z.enum(JOURNEY_TRIGGERS),
  enabled: z.boolean(),
  template: z.enum(TEMPLATE_KEYS).nullable(),
  steps: z.int(),
  runs: z.int(),
  activeRuns: z.int(),
  updatedAt: z.date(),
});
export type JourneySummaryDto = z.infer<typeof JourneySummaryDto>;

export const JourneyDetailDto = JourneySummaryDto.extend({
  enabledAt: z.date().nullable(),
  /** The event's IANA zone (event times show in it); null for a series journey. */
  timeZone: z.string().nullable(),
  steps: z.array(StepDto),
  stepCount: z.int(),
  actions: Counts,
  /** Actions per step position and status (the step list's "sent 12 · waiting 30"). */
  byStep: z.array(z.object({ position: z.int(), counts: Counts })),
});
export type JourneyDetailDto = z.infer<typeof JourneyDetailDto>;
export const journeySerializer = defineSerializer('automations.journey', JourneyDetailDto);

export const RunDto = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  trigger: z.enum(JOURNEY_TRIGGERS),
  triggeredAt: z.date(),
  status: z.enum(RUN_STATUSES),
  reason: z.string().nullable(),
  counts: Counts,
  /** When the next pending step is due, if any. */
  nextAt: z.date().nullable(),
});
export type RunDto = z.infer<typeof RunDto>;
export const RunPageDto = z.object({ rows: z.array(RunDto), nextBefore: z.uuid().nullable() });
export type RunPageDto = z.infer<typeof RunPageDto>;
export const runPageSerializer = defineSerializer('automations.runs', RunPageDto);

export const ActionDto = z.object({
  id: z.uuid(),
  position: z.int(),
  action: z.enum(STEP_ACTIONS),
  scheduledFor: z.date(),
  status: z.enum(ACTION_STATUSES),
  attempts: z.int(),
  outcome: z.string().nullable(),
  completedAt: z.date().nullable(),
});
export type ActionDto = z.infer<typeof ActionDto>;
export const RunDetailDto = z.object({
  run: RunDto.omit({ counts: true, nextAt: true }).extend({ eventId: z.uuid(), eventName: z.string() }),
  actions: z.array(ActionDto),
});
export type RunDetailDto = z.infer<typeof RunDetailDto>;
export const runDetailSerializer = defineSerializer('automations.run', RunDetailDto);

// ---------------------------------------------------------------------------------------------
// Reads

const emptyCounts = (): ActionCounts =>
  Object.fromEntries(ACTION_STATUSES.map((s) => [s, 0])) as unknown as ActionCounts;

async function findJourneyTx(tx: TenantTx, journeyId: string, lock = false) {
  // System journeys (M4.1f RSVP reminders) are managed by their module, never here.
  const q = tx
    .select()
    .from(journeys)
    .where(and(eq(journeys.id, journeyId), inArray(journeys.trigger, [...JOURNEY_TRIGGERS])));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError('not_found', 'Journey not found');
  return row;
}

export async function journeyStepsTx(tx: TenantTx, journeyId: string): Promise<StepDto[]> {
  const rows = await tx
    .select()
    .from(journeySteps)
    .where(eq(journeySteps.journeyId, journeyId))
    .orderBy(asc(journeySteps.position));
  return rows.map((r) => StepDto.parse(r));
}

async function summaries(tx: TenantTx, rows: (typeof journeys.$inferSelect)[]): Promise<JourneySummaryDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const stepCounts = await tx
    .select({ id: journeySteps.journeyId, n: count() })
    .from(journeySteps)
    .where(inArray(journeySteps.journeyId, ids))
    .groupBy(journeySteps.journeyId);
  const runCounts = await tx
    .select({ id: journeyRuns.journeyId, status: journeyRuns.status, n: count() })
    .from(journeyRuns)
    .where(inArray(journeyRuns.journeyId, ids))
    .groupBy(journeyRuns.journeyId, journeyRuns.status);
  const names = new Map<string, string>();
  for (const id of new Set(rows.flatMap((r) => (r.eventId ? [r.eventId] : [])))) {
    const ev = await findEventTx(tx, id);
    if (ev) names.set(id, ev.name);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    eventId: r.eventId,
    eventName: r.eventId ? (names.get(r.eventId) ?? null) : null,
    seriesId: r.seriesId,
    trigger: r.trigger as JourneySummaryDto['trigger'],
    enabled: r.enabled,
    template: (r.template as JourneySummaryDto['template']) ?? null,
    steps: stepCounts.find((s) => s.id === r.id)?.n ?? 0,
    runs: runCounts.filter((c) => c.id === r.id).reduce((s, c) => s + c.n, 0),
    activeRuns: runCounts.find((c) => c.id === r.id && c.status === 'active')?.n ?? 0,
    updatedAt: r.updatedAt,
  }));
}

/** The org's journeys, newest change first (M3.7a). Anyone who can read marketing may look. */
export const listJourneysQuery = tenantQuery({
  name: 'automations.listJourneys',
  input: z.object({ eventId: z.uuid().nullish() }),
  output: z.array(JourneySummaryDto),
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(journeys)
      .where(
        and(
          input.eventId ? eq(journeys.eventId, input.eventId) : undefined,
          inArray(journeys.trigger, [...JOURNEY_TRIGGERS]),
        ),
      )
      .orderBy(desc(journeys.updatedAt), desc(journeys.id))
      .limit(500);
    return summaries(tx, rows);
  },
});

/** One journey with its steps and what its steps did so far. */
export const journeyQuery = tenantQuery({
  name: 'automations.journey',
  input: z.object({ journeyId: z.uuid() }),
  output: JourneyDetailDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => {
    const row = await findJourneyTx(tx, input.journeyId);
    const [summary] = await summaries(tx, [row]);
    const steps = await journeyStepsTx(tx, row.id);
    const grouped = await tx
      .select({ position: scheduledActions.position, status: scheduledActions.status, n: count() })
      .from(scheduledActions)
      .where(eq(scheduledActions.journeyId, row.id))
      .groupBy(scheduledActions.position, scheduledActions.status);
    const actions = emptyCounts();
    const byStep = new Map<number, ActionCounts>();
    for (const g of grouped) {
      const status = g.status as keyof ActionCounts;
      actions[status] += g.n;
      const c = byStep.get(g.position) ?? emptyCounts();
      c[status] += g.n;
      byStep.set(g.position, c);
    }
    return journeySerializer.serialize({
      ...(summary as JourneySummaryDto),
      enabledAt: row.enabledAt,
      timeZone: row.eventId ? ((await findEventTx(tx, row.eventId))?.timezone ?? null) : null,
      steps,
      stepCount: steps.length,
      actions,
      byStep: [...byStep].sort(([a], [b]) => a - b).map(([position, counts]) => ({ position, counts })),
    });
  },
});

async function countsOfRuns(tx: TenantTx, runIds: readonly string[]) {
  const out = new Map<string, { counts: ActionCounts; nextAt: Date | null }>();
  if (runIds.length === 0) return out;
  const rows = await tx
    .select({
      runId: scheduledActions.runId,
      status: scheduledActions.status,
      n: count(),
      next: sql<
        Date | string | null
      >`min(${scheduledActions.dueAt}) filter (where ${scheduledActions.status} = 'pending')`,
    })
    .from(scheduledActions)
    .where(inArray(scheduledActions.runId, [...runIds]))
    .groupBy(scheduledActions.runId, scheduledActions.status);
  for (const r of rows) {
    const cur = out.get(r.runId) ?? { counts: emptyCounts(), nextAt: null };
    cur.counts[r.status as keyof ActionCounts] += r.n;
    if (r.next) cur.nextAt = new Date(r.next);
    out.set(r.runId, cur);
  }
  return out;
}

export const RUNS_PAGE = 50;
const NO_ID = '00000000-0000-0000-0000-000000000000';

/**
 * A journey's run history, newest first, 50 per page (keyset on the run id). `q` narrows it to
 * people whose email or name contains the text (a person's history in this journey).
 */
export const journeyRunsQuery = tenantQuery({
  name: 'automations.journeyRuns',
  input: z.object({
    journeyId: z.uuid(),
    before: z.uuid().nullish(),
    q: z.string().trim().max(200).nullish(),
  }),
  output: RunPageDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => {
    await findJourneyTx(tx, input.journeyId);
    const matching = input.q ? await contactIdsMatchingTx(tx, input.q) : null;
    const rows = await tx
      .select()
      .from(journeyRuns)
      .where(
        and(
          eq(journeyRuns.journeyId, input.journeyId),
          input.before ? lt(journeyRuns.id, input.before) : undefined,
          matching ? inArray(journeyRuns.contactId, matching.length ? matching : [NO_ID]) : undefined,
        ),
      )
      .orderBy(desc(journeyRuns.id))
      .limit(RUNS_PAGE + 1);
    const page = rows.slice(0, RUNS_PAGE);
    const people = await contactsByIdsTx(
      tx,
      page.flatMap((r) => (r.contactId ? [r.contactId] : [])),
    );
    const counts = await countsOfRuns(
      tx,
      page.map((r) => r.id),
    );
    return runPageSerializer.serialize({
      rows: page.map((r) => ({
        id: r.id,
        contactId: r.contactId as string,
        name: r.contactId ? (people.get(r.contactId)?.name ?? null) : null,
        email: r.contactId ? (people.get(r.contactId)?.email ?? null) : null,
        trigger: r.trigger as RunDto['trigger'],
        triggeredAt: r.triggeredAt,
        status: r.status as RunDto['status'],
        reason: r.reason,
        counts: counts.get(r.id)?.counts ?? emptyCounts(),
        nextAt: counts.get(r.id)?.nextAt ?? null,
      })),
      nextBefore: rows.length > RUNS_PAGE ? (page[page.length - 1]?.id ?? null) : null,
    });
  },
});

/** One person's run: every step, when it was (or is) due and what it did. */
export const journeyRunQuery = tenantQuery({
  name: 'automations.journeyRun',
  input: z.object({ journeyId: z.uuid(), runId: z.uuid() }),
  output: RunDetailDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => {
    const [run] = await tx
      .select()
      .from(journeyRuns)
      .where(and(eq(journeyRuns.id, input.runId), eq(journeyRuns.journeyId, input.journeyId)));
    if (!run?.contactId) throw new DomainError('not_found', 'Run not found');
    const contactId = run.contactId;
    const person = (await contactsByIdsTx(tx, [contactId])).get(contactId);
    const ev = await findEventTx(tx, run.eventId);
    const actions = await tx
      .select()
      .from(scheduledActions)
      .where(eq(scheduledActions.runId, run.id))
      .orderBy(asc(scheduledActions.position));
    return runDetailSerializer.serialize({
      run: {
        id: run.id,
        contactId,
        name: person?.name ?? null,
        email: person?.email ?? null,
        trigger: run.trigger as RunDto['trigger'],
        triggeredAt: run.triggeredAt,
        status: run.status as RunDto['status'],
        reason: run.reason,
        eventId: run.eventId,
        eventName: ev?.name ?? '',
      },
      actions: actions.map((a) => ({
        id: a.id,
        position: a.position,
        action: a.action as ActionDto['action'],
        scheduledFor: a.scheduledFor,
        status: a.status as ActionDto['status'],
        attempts: a.attempts,
        outcome: a.outcome,
        completedAt: a.completedAt,
      })),
    });
  },
});

// ---------------------------------------------------------------------------------------------
// Writes

const scopeInput = {
  eventId: z.uuid().nullish(),
  seriesId: z.uuid().nullish(),
};

function checkSteps(trigger: (typeof JOURNEY_TRIGGERS)[number], steps: readonly Step[]) {
  const problem = stepProblems(trigger, steps)[0];
  if (problem)
    throw new DomainError('validation_failed', 'A step waits from a trigger this journey does not have', {
      field: `steps.${problem.index}.${problem.field}`,
      reason: 'anchor_needs_trigger',
    });
}

async function writeStepsTx(
  tx: TenantTx,
  orgId: string,
  journeyId: string,
  steps: readonly Step[],
  now: Date,
) {
  const existing = await tx
    .select({ id: journeySteps.id })
    .from(journeySteps)
    .where(eq(journeySteps.journeyId, journeyId));
  const keep = new Set(steps.flatMap((s) => (s.id ? [s.id] : [])));
  const known = new Set(existing.map((e) => e.id));
  for (const id of keep)
    if (!known.has(id))
      throw new DomainError('not_found', 'Step not found', { field: 'steps', reason: 'unknown_step' });
  const gone = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (gone.length) await tx.delete(journeySteps).where(inArray(journeySteps.id, gone));
  // Move the kept steps out of the way first: positions are unique per journey.
  if (keep.size)
    await tx
      .update(journeySteps)
      .set({ position: sql`${journeySteps.position} + 500` })
      .where(inArray(journeySteps.id, [...keep]));
  for (const [position, s] of steps.entries()) {
    const values = {
      position,
      anchor: s.anchor,
      offsetDays: s.offsetDays,
      offsetMinutes: s.offsetMinutes,
      atTime: s.atTime,
      action: s.action,
      subject: s.subject,
      body: s.body,
      label: s.label,
      condition: s.condition,
    };
    const isMessage = ['email', 'sms', 'whatsapp', 'push'].includes(s.action);
    const clean = {
      ...values,
      subject: isMessage ? values.subject : null,
      body: isMessage ? values.body : null,
      label: s.action === 'label' ? values.label : null,
    };
    if (s.id)
      await tx
        .update(journeySteps)
        .set({ ...clean, updatedAt: now })
        .where(eq(journeySteps.id, s.id));
    else await tx.insert(journeySteps).values({ ...clean, orgId, journeyId });
  }
}

export const CreateJourneyInput = z
  .object({
    name: JourneyName,
    ...scopeInput,
    trigger: z.enum(JOURNEY_TRIGGERS),
    template: z.enum(TEMPLATE_KEYS).nullish(),
    steps: StepsInput.default([]),
  })
  .refine((v) => Boolean(v.eventId) !== Boolean(v.seriesId), { path: ['eventId'], message: 'one_scope' });

/** Create a journey (off) for an event or a series, blank or from a template's steps. */
export const createJourneyCommand = tenantCommand({
  name: 'automations.createJourney',
  input: CreateJourneyInput,
  output: z.object({ id: z.uuid() }),
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (input.eventId && !(await findEventTx(tx, input.eventId)))
      throw new DomainError('not_found', 'Event not found', { field: 'eventId' });
    checkSteps(input.trigger, input.steps);
    const who = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    // A series of another org (or none) fails the composite FK: not found, like a missing event.
    const [row] = await tx
      .insert(journeys)
      .values({
        orgId,
        name: input.name,
        eventId: input.eventId ?? null,
        seriesId: input.seriesId ?? null,
        trigger: input.trigger,
        template: input.template ?? null,
        createdBy: who,
        updatedBy: who,
      })
      .returning({ id: journeys.id })
      .catch((err: unknown) => {
        if (isForeignKeyViolation(err, 'journeys_series_fk'))
          throw new DomainError('not_found', 'Series not found', { field: 'seriesId' });
        throw err;
      });
    if (!row) throw new DomainError('internal');
    await writeStepsTx(tx, orgId, row.id, input.steps, ctx.now);
    return row;
  },
  audit: (input, r) => ({
    action: 'automations.journey.create',
    targetType: 'journey',
    targetId: r.id,
    data: { trigger: input.trigger, template: input.template ?? null, steps: input.steps.length },
  }),
});

/**
 * Save a journey's name, trigger and steps (in order; a step keeps its id). Only while it is off:
 * people already on their way keep the steps they were planned with, so switch it off, edit, and
 * switch it on again.
 */
export const updateJourneyCommand = tenantCommand({
  name: 'automations.updateJourney',
  input: z.object({
    journeyId: z.uuid(),
    name: JourneyName,
    trigger: z.enum(JOURNEY_TRIGGERS),
    steps: StepsInput,
  }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await findJourneyTx(tx, input.journeyId, true);
    if (row.enabled)
      throw new DomainError('invalid_state', 'Switch the journey off to edit it', {
        reason: 'journey_enabled',
      });
    checkSteps(input.trigger, input.steps);
    await tx
      .update(journeys)
      .set({
        name: input.name,
        trigger: input.trigger,
        updatedAt: ctx.now,
        updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .where(eq(journeys.id, row.id));
    await writeStepsTx(tx, requireOrg(ctx), row.id, input.steps, ctx.now);
    return { id: row.id };
  },
  audit: (input) => ({
    action: 'automations.journey.update',
    targetType: 'journey',
    targetId: input.journeyId,
    data: { trigger: input.trigger, steps: input.steps.length },
  }),
});

/**
 * Switch a journey on or off. On: it needs at least one step, and people are enrolled from now on
 * (never retroactively). Off: nobody new enters and every pending step is cancelled
 * (`journey_disabled`); what already ran stays in the history.
 */
export const setJourneyEnabledCommand = tenantCommand({
  name: 'automations.setJourneyEnabled',
  input: z.object({ journeyId: z.uuid(), enabled: z.boolean() }),
  output: z.object({ enabled: z.boolean(), cancelled: z.int() }),
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await findJourneyTx(tx, input.journeyId, true);
    if (row.enabled === input.enabled) return { enabled: row.enabled, cancelled: 0 };
    let cancelled = 0;
    if (input.enabled) {
      const steps = await journeyStepsTx(tx, row.id);
      if (steps.length === 0)
        throw new DomainError('invalid_state', 'Add a step first', { reason: 'no_steps' });
      checkSteps(row.trigger as (typeof JOURNEY_TRIGGERS)[number], steps as Step[]);
    } else {
      cancelled = await cancelRunsTx(tx, eq(journeyRuns.journeyId, row.id), 'journey_disabled', ctx.now);
    }
    await tx
      .update(journeys)
      .set({
        enabled: input.enabled,
        enabledAt: input.enabled ? ctx.now : row.enabledAt,
        updatedAt: ctx.now,
        updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .where(eq(journeys.id, row.id));
    return { enabled: input.enabled, cancelled };
  },
  audit: (input, r) => ({
    action: input.enabled ? 'automations.journey.enable' : 'automations.journey.disable',
    targetType: 'journey',
    targetId: input.journeyId,
    data: { cancelled: r?.cancelled ?? 0 },
  }),
});

/** Delete a journey that never enrolled anyone (history is never deleted). */
export const deleteJourneyCommand = tenantCommand({
  name: 'automations.deleteJourney',
  input: z.object({ journeyId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'marketing',
  permission: 'marketing:write',
  category: 'delete',
  handler: async ({ input, tx }) => {
    const row = await findJourneyTx(tx, input.journeyId, true);
    const [runs] = await tx.select({ n: count() }).from(journeyRuns).where(eq(journeyRuns.journeyId, row.id));
    if (row.enabled || (runs?.n ?? 0) > 0)
      throw new DomainError('invalid_state', 'A journey with a history cannot be deleted', {
        reason: row.enabled ? 'journey_enabled' : 'has_runs',
      });
    await tx.delete(journeys).where(eq(journeys.id, row.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'automations.journey.delete',
    targetType: 'journey',
    targetId: input.journeyId,
  }),
});
