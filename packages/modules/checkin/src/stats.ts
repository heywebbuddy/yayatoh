import type { TenantTx } from '@yayatoh/db';
import { and, eq, gte, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { admissions } from './schema.ts';

/** What a report covers: one event (all time), a period of admissions, or both. */
export interface CheckinScope {
  readonly eventId?: string;
  readonly from?: Date;
  readonly to?: Date;
  /**
   * One shard of the tickets (M3.1 sharded counters): tickets whose id's last byte modulo `count`
   * is `index`. A ticket's admissions all fall in its shard, so shard counts add up exactly.
   */
  readonly shard?: { readonly index: number; readonly count: number };
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
  if (scope.shard)
    where.push(
      sql`get_byte(uuid_send(${admissions.ticketId}), 15) % ${scope.shard.count}::int = ${scope.shard.index}::int`,
    );
  const [r] = await tx
    .select({
      tickets: sql<number>`count(distinct ${admissions.ticketId})::int`,
      admissions: sql<number>`count(*)::int`,
    })
    .from(admissions)
    .where(and(...where));
  return { tickets: r?.tickets ?? 0, admissions: r?.admissions ?? 0 };
}

export interface CheckinSeriesFact {
  readonly bucketStart: Date;
  readonly shard: number;
  /** Tickets with a live admission in the bucket. */
  readonly tickets: number;
}

/**
 * Live admissions of one event per UTC bucket of admission time and ticket shard (M3.1 time
 * series). With `from`/`to`/`shard` in scope it reads one bucket window; without, the whole
 * event (a rebuild). The same query serves both.
 */
export async function checkinSeriesTx(
  tx: TenantTx,
  scope: CheckinScope & { readonly eventId: string },
  bucket: 'minute' | 'hour',
  shards: number,
): Promise<CheckinSeriesFact[]> {
  const parts: SQL[] = [sql`a.event_id = ${scope.eventId}::uuid`];
  if (scope.from) parts.push(sql`a.admitted_at >= ${scope.from.toISOString()}::timestamptz`);
  if (scope.to) parts.push(sql`a.admitted_at < ${scope.to.toISOString()}::timestamptz`);
  if (scope.shard)
    parts.push(sql`get_byte(uuid_send(a.ticket_id), 15) % ${shards}::int = ${scope.shard.index}::int`);
  // Positional GROUP BY: the bucket and shard expressions carry parameters.
  const rows = await tx.execute<{ bucket_start: string; shard: number; tickets: number }>(sql`
    select date_trunc(${bucket}, a.admitted_at, 'UTC') as bucket_start,
      get_byte(uuid_send(a.ticket_id), 15) % ${shards}::int as shard,
      count(distinct a.ticket_id)::int as tickets
    from checkin.admissions a
    where a.undone_at is null and ${sql.join(parts, sql` and `)}
    group by 1, 2`);
  return rows.map((r) => ({
    bucketStart: new Date(r.bucket_start),
    shard: Number(r.shard),
    tickets: Number(r.tickets),
  }));
}
