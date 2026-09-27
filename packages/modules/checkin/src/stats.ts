import type { TenantTx } from '@yayatoh/db';
import { and, eq, gte, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { admissions } from './schema.ts';

/** What a report covers: one event (all time), a period of admissions, or both. */
export interface CheckinScope {
  readonly eventId?: string;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * Check-in facts for reports (M1.12): tickets with at least one live (not undone) admission,
 * and the number of live admissions (a multi-day pass counts once per day). Periods filter on
 * `admitted_at`, half-open [from, to).
 */
export async function checkinFactsTx(
  tx: TenantTx,
  scope: CheckinScope,
): Promise<{ tickets: number; admissions: number }> {
  const where: SQL[] = [isNull(admissions.undoneAt)];
  if (scope.eventId) where.push(eq(admissions.eventId, scope.eventId));
  if (scope.from) where.push(gte(admissions.admittedAt, scope.from));
  if (scope.to) where.push(lt(admissions.admittedAt, scope.to));
  const [r] = await tx
    .select({
      tickets: sql<number>`count(distinct ${admissions.ticketId})::int`,
      admissions: sql<number>`count(*)::int`,
    })
    .from(admissions)
    .where(and(...where));
  return { tickets: r?.tickets ?? 0, admissions: r?.admissions ?? 0 };
}
