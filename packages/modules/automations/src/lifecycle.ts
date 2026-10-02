import type { TenantTx } from '@yayatoh/db';
import { findEventTx, findOccurrenceTx, seriesOfEventTx } from '@yayatoh/events';
import { rsvpDeadlineTx } from '@yayatoh/guests';
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { AnyTrigger, WaitAnchor } from './domain/journey.ts';
import { type Anchors, planStep } from './domain/timing.ts';
import { journeyRuns, journeySteps, journeys, scheduledActions } from './schema.ts';

/**
 * Enrollment, cancellation and rescheduling of journey runs (M3.7a), shared by the commands, the
 * event subscribers and the runner. Everything here runs inside the caller's tenant transaction
 * and is idempotent: replaying the event that caused it lands on the same rows.
 */

/** The key a step's work is done under, once per journey, step, event and person. */
export const actionKey = (journeyId: string, stepId: string, eventId: string, contactId: string) =>
  `journey:${journeyId}:step:${stepId}:event:${eventId}:contact:${contactId}`;

/** A party run's key (M4.1f): once per journey, step, event and party. */
export const partyActionKey = (journeyId: string, stepId: string, eventId: string, partyId: string) =>
  `journey:${journeyId}:step:${stepId}:event:${eventId}:party:${partyId}`;

export interface EventAnchors extends Omit<Anchors, 'trigger'> {
  readonly eventName: string;
  readonly cancelled: boolean;
  readonly postponed: boolean;
}

/** An event's (or one of its dates') start and end in its zone, as they are now. */
export async function eventAnchorsTx(
  tx: TenantTx,
  eventId: string,
  occurrenceId: string | null,
): Promise<EventAnchors | null> {
  const ev = await findEventTx(tx, eventId);
  if (!ev) return null;
  const date = occurrenceId ? await findOccurrenceTx(tx, occurrenceId) : null;
  return {
    eventName: ev.name,
    eventStart: date?.startsAt ?? ev.startsAt,
    eventEnd: date?.endsAt ?? ev.endsAt,
    timeZone: ev.timezone,
    // M4.1f: RSVP reminder steps count back from the deadline (guests, a lower tier).
    rsvpDeadline: await rsvpDeadlineTx(tx, eventId),
    cancelled: ev.status === 'cancelled' || date?.status === 'cancelled',
    postponed: ev.status === 'postponed',
  };
}

/** Switched-on journeys for this event (its own, and its series') with this trigger. */
export async function journeysForEventTx(tx: TenantTx, eventId: string, trigger: AnyTrigger) {
  const seriesId = await seriesOfEventTx(tx, eventId);
  return tx
    .select()
    .from(journeys)
    .where(
      and(
        eq(journeys.enabled, true),
        eq(journeys.trigger, trigger),
        seriesId
          ? or(eq(journeys.eventId, eventId), eq(journeys.seriesId, seriesId))
          : eq(journeys.eventId, eventId),
      ),
    );
}

export interface Enrollment {
  readonly journey: typeof journeys.$inferSelect;
  readonly eventId: string;
  readonly occurrenceId?: string | null;
  /** The person, or (M4.1f system journeys) the party: exactly one. */
  readonly contactId?: string | null;
  readonly partyId?: string | null;
  readonly orderId?: string | null;
  readonly triggeredAt: Date;
  readonly locale?: string | null;
}

const safeLocale = (l: string | null | undefined) => (l && /^[a-z]{2}(-[A-Z]{2})?$/.test(l) ? l : 'en');

/**
 * Put one person on a journey for one event: the run and one scheduled action per step, each at
 * its time (or skipped `too_late`). Returns the run id, or null when they are already on it (a
 * second purchase, a replay) or the event is cancelled. This is also the extension point for new
 * triggers (M4.1d RSVP): a subscriber finds the journeys with `journeysForEventTx` and calls this.
 */
export async function enrollTx(
  tx: TenantTx,
  orgId: string,
  e: Enrollment,
  now: Date,
): Promise<string | null> {
  if (!e.journey.enabled) return null;
  const contactId = e.contactId ?? null;
  const partyId = contactId ? null : (e.partyId ?? null);
  if (!contactId && !partyId) return null;
  const anchors = await eventAnchorsTx(tx, e.eventId, e.occurrenceId ?? null);
  if (!anchors || anchors.cancelled) return null;
  const [run] = await tx
    .insert(journeyRuns)
    .values({
      orgId,
      journeyId: e.journey.id,
      eventId: e.eventId,
      occurrenceId: e.occurrenceId ?? null,
      contactId,
      partyId,
      orderId: e.orderId ?? null,
      trigger: e.journey.trigger,
      triggeredAt: e.triggeredAt,
      locale: safeLocale(e.locale),
    })
    .onConflictDoNothing()
    .returning({ id: journeyRuns.id });
  if (!run) return null;
  const steps = await tx
    .select()
    .from(journeySteps)
    .where(eq(journeySteps.journeyId, e.journey.id))
    .orderBy(journeySteps.position);
  let pending = 0;
  for (const s of steps) {
    const wait = {
      anchor: s.anchor as WaitAnchor,
      offsetDays: s.offsetDays,
      offsetMinutes: s.offsetMinutes,
      atTime: s.atTime,
    };
    // Postponed: the event has no date to plan from; its steps wait (`event_postponed`) until then.
    const plan =
      anchors.postponed && wait.anchor !== 'trigger'
        ? null
        : planStep(wait, { ...anchors, trigger: e.triggeredAt }, now, 'enroll');
    const at = plan && 'dueAt' in plan ? plan.dueAt : now;
    if (plan && 'dueAt' in plan) pending += 1;
    await tx
      .insert(scheduledActions)
      .values({
        orgId,
        runId: run.id,
        journeyId: e.journey.id,
        stepId: s.id,
        eventId: e.eventId,
        contactId,
        partyId,
        position: s.position,
        action: s.action,
        idempotencyKey: contactId
          ? actionKey(e.journey.id, s.id, e.eventId, contactId)
          : partyActionKey(e.journey.id, s.id, e.eventId, partyId as string),
        scheduledFor: at,
        dueAt: at,
        status: plan ? ('dueAt' in plan ? 'pending' : 'skipped') : 'cancelled',
        outcome: plan ? ('dueAt' in plan ? null : plan.skip) : 'event_postponed',
        completedAt: plan && 'dueAt' in plan ? null : now,
      })
      .onConflictDoNothing();
  }
  if (pending === 0 && !anchors.postponed) await settleRunsTx(tx, [run.id], now);
  return run.id;
}

/**
 * Cancel the active runs matching `where` and their pending steps (a full refund, a cancelled
 * ticket or event, the journey switched off). Done steps stay as they were. Returns how many
 * pending steps were cancelled.
 */
export async function cancelRunsTx(
  tx: TenantTx,
  where: SQL | undefined,
  reason: string,
  now: Date,
): Promise<number> {
  const runs = await tx
    .update(journeyRuns)
    .set({ status: 'cancelled', reason, endedAt: now, updatedAt: now })
    .where(and(where, eq(journeyRuns.status, 'active')))
    .returning({ id: journeyRuns.id });
  if (runs.length === 0) return 0;
  const rows = await tx
    .update(scheduledActions)
    .set({ status: 'cancelled', outcome: reason, completedAt: now, updatedAt: now })
    .where(
      and(
        inArray(
          scheduledActions.runId,
          runs.map((r) => r.id),
        ),
        or(
          eq(scheduledActions.status, 'pending'),
          // Parked while the event was postponed: now cancelled for good.
          and(eq(scheduledActions.status, 'cancelled'), eq(scheduledActions.outcome, 'event_postponed')),
        ),
      ),
    )
    .returning({ id: scheduledActions.id });
  return rows.length;
}

/** Runs with nothing left to do are completed. */
export async function settleRunsTx(tx: TenantTx, runIds: readonly string[], now: Date): Promise<void> {
  if (runIds.length === 0) return;
  await tx
    .update(journeyRuns)
    .set({ status: 'completed', endedAt: now, updatedAt: now })
    .where(
      and(
        inArray(journeyRuns.id, [...runIds]),
        eq(journeyRuns.status, 'active'),
        sql`not exists (select 1 from ${scheduledActions} a where a.run_id = ${journeyRuns.id} and a.org_id = ${journeyRuns.orgId} and (a.status = 'pending' or (a.status = 'cancelled' and a.outcome = 'event_postponed')))`,
      ),
    );
}

export interface RescheduleResult {
  moved: number;
  parked: number;
  skipped: number;
  unchanged: number;
}

/**
 * Pending steps follow the event (M3.7a "reschedule on date change"): each is re-planned from the
 * event's (or its date's) start and end as they are now, never from the change itself, so replays
 * and out-of-order events land on the same result. Steps that wait from the trigger keep their time.
 * Postponed: event-anchored steps are parked (`event_postponed`) and come back when it is
 * rescheduled. Steps that already ran are history and never run again (their key is spent).
 */
export async function rescheduleEventTx(tx: TenantTx, eventId: string, now: Date): Promise<RescheduleResult> {
  const result: RescheduleResult = { moved: 0, parked: 0, skipped: 0, unchanged: 0 };
  const open = and(
    eq(scheduledActions.eventId, eventId),
    or(
      eq(scheduledActions.status, 'pending'),
      and(eq(scheduledActions.status, 'cancelled'), eq(scheduledActions.outcome, 'event_postponed')),
    ),
  );
  // Lock the steps first (a runner claiming one of them waits, or skips it while it is locked).
  const locked = await tx
    .select({ id: scheduledActions.id })
    .from(scheduledActions)
    .where(open)
    .for('update');
  if (locked.length === 0) return result;
  const rows = await tx
    .select({ action: scheduledActions, step: journeySteps, run: journeyRuns })
    .from(scheduledActions)
    .innerJoin(
      journeyRuns,
      and(eq(journeyRuns.id, scheduledActions.runId), eq(journeyRuns.orgId, scheduledActions.orgId)),
    )
    .innerJoin(
      journeySteps,
      and(eq(journeySteps.id, scheduledActions.stepId), eq(journeySteps.orgId, scheduledActions.orgId)),
    )
    .where(
      and(
        inArray(
          scheduledActions.id,
          locked.map((l) => l.id),
        ),
        eq(journeyRuns.status, 'active'),
      ),
    );
  const anchorsOf = new Map<string, EventAnchors | null>();
  const touched = new Set<string>();
  for (const { action, step, run } of rows) {
    if (step.anchor === 'trigger') {
      result.unchanged += 1;
      continue;
    }
    const key = run.occurrenceId ?? '';
    if (!anchorsOf.has(key)) anchorsOf.set(key, await eventAnchorsTx(tx, eventId, run.occurrenceId));
    const anchors = anchorsOf.get(key);
    // Cancellation is its own hook (cancelRunsTx); a missing event leaves the step alone.
    if (!anchors || anchors.cancelled) {
      result.unchanged += 1;
      continue;
    }
    if (anchors.postponed) {
      if (action.status === 'cancelled') result.unchanged += 1;
      else {
        await tx
          .update(scheduledActions)
          .set({ status: 'cancelled', outcome: 'event_postponed', completedAt: now, updatedAt: now })
          .where(eq(scheduledActions.id, action.id));
        result.parked += 1;
      }
      continue;
    }
    const plan = planStep(
      {
        anchor: step.anchor as WaitAnchor,
        offsetDays: step.offsetDays,
        offsetMinutes: step.offsetMinutes,
        atTime: step.atTime,
      },
      { ...anchors, trigger: run.triggeredAt },
      now,
      'reschedule',
    );
    if ('skip' in plan) {
      await tx
        .update(scheduledActions)
        .set({ status: 'skipped', outcome: plan.skip, completedAt: now, updatedAt: now })
        .where(eq(scheduledActions.id, action.id));
      result.skipped += 1;
      touched.add(run.id);
      continue;
    }
    const same =
      action.status === 'pending' &&
      (action.scheduledFor.getTime() === plan.dueAt.getTime() ||
        // Already due and still due (a replay a moment later): not a change.
        (plan.dueAt.getTime() <= now.getTime() && action.scheduledFor.getTime() <= now.getTime()));
    if (same) {
      result.unchanged += 1;
      continue;
    }
    await tx
      .update(scheduledActions)
      .set({
        status: 'pending',
        scheduledFor: plan.dueAt,
        // A retry waiting for later keeps its later time.
        dueAt: action.attempts > 0 && action.dueAt > plan.dueAt ? action.dueAt : plan.dueAt,
        outcome: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(eq(scheduledActions.id, action.id));
    result.moved += 1;
  }
  await settleRunsTx(tx, [...touched], now);
  return result;
}

/** Active runs of these people at this event who no longer hold an active place there. */
export function runsOfContactsWhere(eventId: string, contactIds: readonly string[]): SQL | undefined {
  return and(eq(journeyRuns.eventId, eventId), inArray(journeyRuns.contactId, [...contactIds]));
}

/** M4.1f: a party's runs at this event (its RSVP reminders). */
export const runsOfParty = (eventId: string, partyId: string) =>
  and(eq(journeyRuns.eventId, eventId), eq(journeyRuns.partyId, partyId));

export const runsOfOrder = (orderId: string) => eq(journeyRuns.orderId, orderId);
export const runsOfEvent = (eventId: string, occurrenceId?: string | null) =>
  occurrenceId
    ? and(eq(journeyRuns.eventId, eventId), eq(journeyRuns.occurrenceId, occurrenceId))
    : eq(journeyRuns.eventId, eventId);
