import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { platformFeesByOrgTx } from '@yayatoh/payments';
import { sql } from 'drizzle-orm';
import type { Staff } from './staff.ts';

/** One row of the commission report: an explicit allowlist, never raw rows. */
export interface CommissionRow {
  readonly orgId: string;
  readonly slug: string;
  readonly name: string;
  readonly currency: string;
  readonly sales: number;
  readonly chargedMinor: number;
  readonly refundedMinor: number;
  readonly netMinor: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const valid = (d: string | undefined): d is string =>
  Boolean(d && DAY.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));

export interface CommissionPeriod {
  readonly from: string;
  readonly to: string;
  readonly error?: 'badRange' | 'badDate';
}

/** Inclusive UTC calendar days; the current month by default. */
export function commissionPeriod(sp: { from?: string; to?: string }, now = new Date()): CommissionPeriod {
  const today = now.toISOString().slice(0, 10);
  const month = { from: `${today.slice(0, 8)}01`, to: today };
  if (!sp.from && !sp.to) return month;
  if (!valid(sp.from) || !valid(sp.to)) return { ...month, error: 'badDate' };
  if (sp.from > sp.to) return { ...month, error: 'badRange' };
  return { from: sp.from, to: sp.to };
}

/**
 * Platform fees per org and currency for a period (M1.12c), from the ledger. A cross-tenant read
 * (platform_reader), so it is audited with the period in the reason.
 */
export async function commissionReport(staff: Staff, p: CommissionPeriod): Promise<CommissionRow[]> {
  const from = new Date(`${p.from}T00:00:00Z`);
  const to = new Date(Date.parse(`${p.to}T00:00:00Z`) + 86_400_000);
  return withPlatformReader(
    { actor: staff.actor, reason: `staff console: commission report ${p.from} to ${p.to}` },
    async (tx) => {
      const rows = await platformFeesByOrgTx(tx, { from, to });
      if (rows.length === 0) return [];
      const orgs = await tx.execute<{ id: string; slug: string; name: string }>(sql`
        select id, slug, name from tenancy.organizations
        where id in (${sql.join(
          [...new Set(rows.map((r) => r.orgId))].map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`);
      const byId = new Map(orgs.map((o) => [o.id, o]));
      return rows.map((r) => ({
        orgId: r.orgId,
        slug: byId.get(r.orgId)?.slug ?? '',
        name: byId.get(r.orgId)?.name ?? '',
        currency: r.currency,
        sales: r.sales,
        chargedMinor: r.chargedMinor,
        refundedMinor: r.refundedMinor,
        netMinor: r.netMinor,
      }));
    },
  );
}
