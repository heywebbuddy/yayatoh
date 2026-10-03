import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  notSubject,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { asc, inArray, or } from 'drizzle-orm';
import { journeyRuns, scheduledActions } from './schema.ts';

/** The person's journey runs: enrolled as their contact, or by an order they placed. */
async function runsTx(tx: TenantTx, s: DataSubject) {
  const contacts = refsOf(s, 'contact');
  const orders = refsOf(s, 'order');
  if (contacts.length === 0 && orders.length === 0) return [];
  return tx
    .select()
    .from(journeyRuns)
    .where(
      or(
        contacts.length ? inArray(journeyRuns.contactId, contacts) : undefined,
        orders.length ? inArray(journeyRuns.orderId, orders) : undefined,
      ),
    )
    .orderBy(asc(journeyRuns.createdAt));
}

/**
 * automations' part of a data-subject request (M6.1c). The person's journey runs and their
 * scheduled steps (history and pending work) are deleted, so nothing further is sent to them.
 * Journeys and their steps are the organizer's automation.
 */
export const automationsDataSubjects = defineDataSubjectContributor({
  module: 'automations',
  tables: {
    'automations.journey_steps': notSubject("the organizer's message copy, sent to everyone in a journey"),
    'automations.journey_runs': DELETE,
    'automations.scheduled_actions': DELETE,
  },
  async export(tx, s) {
    const runs = await runsTx(tx, s);
    const steps = runs.length
      ? await tx
          .select()
          .from(scheduledActions)
          .where(
            inArray(
              scheduledActions.runId,
              runs.map((r) => r.id),
            ),
          )
          .orderBy(asc(scheduledActions.scheduledFor))
      : [];
    return {
      sections: {
        journeys: runs.map((r) => ({
          eventId: r.eventId,
          orderId: r.orderId,
          trigger: r.trigger,
          triggeredAt: r.triggeredAt,
          locale: r.locale,
          status: r.status,
          endedAt: r.endedAt,
          steps: steps
            .filter((a) => a.runId === r.id)
            .map((a) => ({
              action: a.action,
              scheduledFor: a.scheduledFor,
              status: a.status,
              outcome: a.outcome,
              completedAt: a.completedAt,
            })),
        })),
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const runs = await runsTx(tx, s);
    const contacts = refsOf(s, 'contact');
    const ids = runs.map((r) => r.id);
    if (ids.length === 0 && contacts.length === 0) return { erased: {} };
    const actions = await tx
      .delete(scheduledActions)
      .where(
        or(
          ids.length ? inArray(scheduledActions.runId, ids) : undefined,
          contacts.length ? inArray(scheduledActions.contactId, contacts) : undefined,
        ),
      )
      .returning({ id: scheduledActions.id });
    const gone = ids.length
      ? await tx.delete(journeyRuns).where(inArray(journeyRuns.id, ids)).returning({ id: journeyRuns.id })
      : [];
    return {
      erased: { 'automations.journey_runs': gone.length, 'automations.scheduled_actions': actions.length },
    };
  },
});
