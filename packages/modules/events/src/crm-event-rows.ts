import type { TenantTx } from '@yayatoh/db';
import { and, asc, gt, inArray, ne, type SQL } from 'drizzle-orm';
import { events } from './schema.ts';

/**
 * Events for CRM connectors (M6.5b: one Salesforce campaign per event). Drafts are left out
 * (nothing to market yet). Times stay instants; the connector renders dates in `timezone`.
 */
export interface CrmEventRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Events in id order after `afterId`, or these ids. */
export async function crmEventRowsTx(
  tx: TenantTx,
  opts: { readonly afterId?: string | null; readonly ids?: readonly string[]; readonly limit: number },
): Promise<CrmEventRow[]> {
  if (opts.ids && opts.ids.length === 0) return [];
  const where: SQL[] = [ne(events.status, 'draft')];
  if (opts.ids) where.push(inArray(events.id, [...opts.ids]));
  else if (opts.afterId) where.push(gt(events.id, opts.afterId));
  return tx
    .select({
      id: events.id,
      name: events.name,
      status: events.status,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
    })
    .from(events)
    .where(and(...where))
    .orderBy(asc(events.id))
    .limit(Math.max(1, Math.min(opts.limit, 1000)));
}
