import { type AlertDeps, evaluateOrgNow } from '@yayatoh/alerts';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';

/**
 * The alert engine's scheduled evaluation (M3.2b, roadmap §5.2 cadence): every 30 s the events
 * that are live or in pre-show, every 5 minutes (`full`) planning events and the org rules too.
 * It is what notices time passing (a device going quiet, a payment getting stuck, a snooze ending,
 * an acknowledgement timing out); outbox events are the subscriber's. Orgs are found through a
 * SECURITY DEFINER function (ids only); each org is evaluated under its own RLS, one failure never
 * stops the others.
 */
export async function sweepAlerts(deps: AlertDeps, opts: { full: boolean }): Promise<{ orgs: number; changes: number }> {
  const orgs = await withPlatformReader(
    { actor: 'system:alerts', reason: 'find orgs with alerts or events to evaluate' },
    (tx) => tx.execute<{ org_id: string }>(sql`select org_id from alerts.orgs_to_evaluate(500)`),
  );
  let changes = 0;
  for (const { org_id } of orgs) {
    try {
      changes += (await evaluateOrgNow(org_id, deps, { full: opts.full })).length;
    } catch (err) {
      console.error('alerts sweep', org_id, err);
    }
  }
  return { orgs: orgs.length, changes };
}
