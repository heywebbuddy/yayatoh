import { attendeeLabelAction } from '@yayatoh/attendees';
import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { bulkStepCommand, createCommandPorts, runBulkOperation } from '@yayatoh/platform';
import { attendeeExportAction } from '@yayatoh/reports';
import { orgAuthorizer } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

/** Every bulk action the apps offer (the web app registers the same list). */
export const BULK_ACTIONS = [attendeeLabelAction, attendeeExportAction] as const;
const step = bulkStepCommand(BULK_ACTIONS);
const ports = createCommandPorts({ entitlements: billingEntitlements, authorizer: orgAuthorizer });

/**
 * Bulk runner tick (leader only): finds unfinished operations through a SECURITY DEFINER
 * function, then works each under its own org's RLS for up to `budgetMs`. The web app runs
 * the first seconds inline, so small operations never wait for this.
 */
export async function runDueBulkOperations(
  budgetMs = 5_000,
  /** Tests: only these orgs (other test files' operations are left alone). */
  onlyOrgs?: ReadonlySet<string>,
): Promise<number> {
  const due = await withPlatformReader(
    { actor: 'system:bulk-runner', reason: 'find unfinished bulk operations' },
    (tx) =>
      tx.execute<{ org_id: string; operation_id: string }>(
        sql`select org_id, operation_id from platform.due_bulk_operations(20)`,
      ),
  );
  const mine = onlyOrgs ? due.filter((d) => onlyOrgs.has(d.org_id)) : due;
  for (const d of mine) await runBulkOperation(step, ports, d.org_id, d.operation_id, budgetMs);
  return mine.length;
}
