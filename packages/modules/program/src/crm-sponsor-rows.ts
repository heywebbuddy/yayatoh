import type { TenantTx } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import type { GrantStatus } from './schema-sponsors.ts';

/**
 * Program sponsors for CRM connectors (M6.5b: Salesforce opportunities). One row per sponsor with
 * its tier and its deal: the active grant, else the pending one, else the latest cancelled one
 * (none: a sponsor listed without a package yet). Amounts stay in integer minor units.
 */
export interface CrmSponsorRow {
  readonly id: string;
  readonly eventId: string;
  readonly name: string;
  readonly tierName: string;
  readonly grant: {
    readonly status: GrantStatus;
    readonly priceMinor: number;
    readonly currency: string;
    readonly activatedAt: Date | null;
    readonly cancelledAt: Date | null;
  } | null;
}

type Raw = {
  id: string;
  event_id: string;
  name: string;
  tier_name: string;
  status: string | null;
  price_minor: string | number | null;
  currency: string | null;
  activated_at: Date | string | null;
  cancelled_at: Date | string | null;
};

const date = (v: Date | string | null) => (v === null ? null : new Date(v));

/** Sponsors in id order after `afterId`, or these ids. */
export async function crmSponsorRowsTx(
  tx: TenantTx,
  opts: { readonly afterId?: string | null; readonly ids?: readonly string[]; readonly limit: number },
): Promise<CrmSponsorRow[]> {
  const by = opts.ids
    ? opts.ids.length
      ? sql`where s.id = any(${sql`ARRAY[${sql.join(
          opts.ids.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[]`})`
      : sql`where false`
    : opts.afterId
      ? sql`where s.id > ${opts.afterId}::uuid`
      : sql``;
  const rows = await tx.execute<Raw>(sql`
    select s.id, s.event_id, s.name, t.name as tier_name,
      g.status, g.price_minor, g.currency, g.activated_at, g.cancelled_at
    from program.sponsors s
    join program.sponsor_tiers t on t.org_id = s.org_id and t.id = s.tier_id
    left join lateral (
      select x.status, x.price_minor, x.currency, x.activated_at, x.cancelled_at
      from program.sponsor_grants x
      where x.org_id = s.org_id and x.sponsor_id = s.id
      order by case x.status when 'active' then 0 when 'pending' then 1 else 2 end, x.created_at desc, x.id desc
      limit 1
    ) g on true
    ${by}
    order by s.id
    limit ${Math.max(1, Math.min(opts.limit, 1000))}`);
  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    name: r.name,
    tierName: r.tier_name,
    grant:
      r.status === null
        ? null
        : {
            status: r.status as GrantStatus,
            priceMinor: Number(r.price_minor ?? 0),
            currency: r.currency ?? 'USD',
            activatedAt: date(r.activated_at),
            cancelledAt: date(r.cancelled_at),
          },
  }));
}
