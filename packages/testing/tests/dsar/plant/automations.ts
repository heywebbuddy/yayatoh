import type { Planter } from '../types.ts';

/**
 * automations: the person enrolled in the fixture's journey by their order, with one step that
 * failed (its error names them) and one still pending.
 */
export const plantAutomations: Planter = async ({ admin, orgId, person, ids }) => {
  if (!ids.contactId || !ids.orderId) throw new Error('plantAutomations: run plantCrm and plantOrders first');
  const [step] = await admin`
    select s.id, s.journey_id, s.position, s.action, j.event_id
    from automations.journey_steps s
    join automations.journeys j on j.org_id = s.org_id and j.id = s.journey_id
    where s.org_id = ${orgId} and j.event_id is not null
    order by s.position limit 1`;
  if (!step) return [];
  const [run] = await admin`
    insert into automations.journey_runs (org_id, journey_id, event_id, contact_id, order_id, trigger, triggered_at)
    values (${orgId}, ${step.journey_id as string}, ${step.event_id as string}, ${ids.contactId}, ${ids.orderId},
      'order_paid', now())
    returning id`;
  const runId = run?.id as string;
  for (const [n, status] of [
    [0, 'failed'],
    [1, 'pending'],
  ] as const)
    await admin`
      insert into automations.scheduled_actions (org_id, run_id, journey_id, step_id, event_id, contact_id, position,
        action, idempotency_key, scheduled_for, due_at, status, last_error, completed_at)
      values (${orgId}, ${runId}, ${step.journey_id as string}, ${step.id as string}, ${step.event_id as string},
        ${ids.contactId}, ${step.position as number}, ${step.action as string}, ${`dsar:${runId}:${n}`}, now(), now(),
        ${status}, ${status === 'failed' ? `bounced: ${person.email} (${person.name})` : null},
        ${status === 'failed' ? new Date() : null})`;
  return ['automations.journey_runs', 'automations.scheduled_actions'];
};
