import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { yearEndStatementsCommand } from '@yayatoh/donations';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { createCommandPorts } from '@yayatoh/platform';
import { orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

export interface YearEndRun {
  readonly orgs: number;
  readonly issued: number;
  readonly failed: number;
}

/**
 * Year-end giving statements (M4.8b, P4-11; leader only, daily): every org with receipts gets,
 * for the previous calendar year in its own timezone, one statement per donor that has none yet
 * (`donations.yearEndStatements`, a platform command run as a system actor). Orgs come from
 * platform_reader (audited); an org with nothing to state costs one empty query. The statements'
 * mailer (outbox) sends each to its donor.
 */
export async function runYearEndStatements(opts: { onlyOrgs?: readonly string[] } = {}): Promise<YearEndRun> {
  const rows = opts.onlyOrgs
    ? opts.onlyOrgs.map((org_id) => ({ org_id }))
    : await withPlatformReader(
        {
          actor: 'system:donations.year-end',
          reason: 'list organizations with receipts for year-end statements',
        },
        (tx) =>
          tx.execute<{ org_id: string }>(
            sql`select distinct org_id from donations.receipts where deductible order by org_id`,
          ),
      );
  let issued = 0;
  let failed = 0;
  for (const { org_id } of rows) {
    const ctx = createCtx({ orgId: org_id, actor: { type: 'system', name: 'donations.year-end' } });
    try {
      issued += (await executeCommand(yearEndStatementsCommand, {}, ctx, ports)).issued;
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ job: 'donations.year-end', org: org_id, error: String(err) }));
    }
  }
  return { orgs: rows.length, issued, failed };
}
