import type { ContactReferenceOwner, MovedRow } from '@yayatoh/crm';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { journeyRuns, scheduledActions } from './schema.ts';

const RUNS = 'automations.journey_runs';
const ACTIONS = 'automations.scheduled_actions';

/**
 * Contact merges (M6.1a, ADR 0022): a merged duplicate's journey runs, and their scheduled steps,
 * move to the person who stays, except a run of a journey the person who stays is already on for
 * that event (one run per journey, event and person): it stays on the duplicate with its steps
 * (kept). An undo moves exactly the recorded rows back. Only this module writes its tables.
 */
export const automationsContactOwner: ContactReferenceOwner = {
  module: 'automations',
  columns: [`${RUNS}.contact_id`, `${ACTIONS}.contact_id`],
  move: async (tx, _ctx, step) => {
    const runs = await tx.execute<{ id: string }>(sql`
      update automations.journey_runs r set contact_id = ${step.toContactId}
      where r.contact_id = ${step.fromContactId}
        and not exists (
          select 1 from automations.journey_runs x
          where x.org_id = r.org_id and x.journey_id = r.journey_id and x.event_id = r.event_id
            and x.contact_id = ${step.toContactId})
      returning r.id`);
    const moved: MovedRow[] = runs.map((r) => ({ table: RUNS, id: r.id }));
    if (runs.length > 0) {
      const actions = await tx
        .update(scheduledActions)
        .set({ contactId: step.toContactId })
        .where(
          and(
            eq(scheduledActions.contactId, step.fromContactId),
            inArray(
              scheduledActions.runId,
              runs.map((r) => r.id),
            ),
          ),
        )
        .returning({ id: scheduledActions.id });
      moved.push(...actions.map((r) => ({ table: ACTIONS, id: r.id })));
    }
    const count = async (t: typeof journeyRuns | typeof scheduledActions) =>
      (
        await tx.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.contactId, step.fromContactId))
      )[0]?.n ?? 0;
    return { moved, kept: { [RUNS]: await count(journeyRuns), [ACTIONS]: await count(scheduledActions) } };
  },
  restore: async (tx, _ctx, step) => {
    const out: MovedRow[] = [];
    for (const [name, t] of [
      [RUNS, journeyRuns],
      [ACTIONS, scheduledActions],
    ] as const) {
      const ids = step.rows.filter((r) => r.table === name).map((r) => r.id);
      if (ids.length === 0) continue;
      const rows = await tx
        .update(t)
        .set({ contactId: step.fromContactId })
        .where(and(eq(t.contactId, step.toContactId), inArray(t.id, ids)))
        .returning({ id: t.id });
      out.push(...rows.map((r) => ({ table: name, id: r.id })));
    }
    return out;
  },
};
