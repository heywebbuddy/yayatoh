import type { TenantTx } from '@yayatoh/db';
import { requireOrg } from '@yayatoh/kernel';
import { organizationDefaultsTx } from '@yayatoh/tenancy';
import { and, eq, sql } from 'drizzle-orm';
import { computeEventSnapshotTx, hashSnapshot } from './compute.ts';
import { eventSync } from './schema.ts';
import type { AnalyticsWarehouse, WarehouseScope } from './warehouse/port.ts';

/** The org's time zone (days of the warehouse); UTC if the org row is gone. */
export async function orgTimeZoneTx(tx: TenantTx, orgId: string): Promise<string> {
  return (await organizationDefaultsTx(tx, orgId))?.timezone ?? 'UTC';
}

export interface SyncResult {
  /** False: the warehouse already held exactly this snapshot. */
  readonly written: boolean;
  readonly rows: number;
}

/**
 * Bring the warehouse up to date for one event (M6.2a): under the event's advisory lock, compute
 * its snapshot from the sources and hand it to the adapter only if it differs from what that
 * adapter last received (`analytics.event_sync` hash). Versions grow with the database clock
 * under the lock, so the newest write always wins in Tinybird. Idempotent: running it again (a
 * replay, a backfill after live ingest) writes nothing.
 */
export async function syncEventTx(
  scope: WarehouseScope,
  warehouse: AnalyticsWarehouse,
  eventId: string,
): Promise<SyncResult> {
  const orgId = requireOrg(scope.ctx);
  const { tx } = scope;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`an:e:${orgId}:${eventId}`}, 0))`);
  const snapshot = await computeEventSnapshotTx(tx, eventId, await orgTimeZoneTx(tx, orgId));
  const hash = hashSnapshot(snapshot);
  const own = and(
    eq(eventSync.orgId, orgId),
    eq(eventSync.adapter, warehouse.name),
    eq(eventSync.eventId, eventId),
  );
  const [prev] = await tx.select({ hash: eventSync.hash, version: eventSync.version }).from(eventSync).where(own);
  if (prev?.hash === hash) return { written: false, rows: 0 };
  if (!prev && snapshot.state === null) return { written: false, rows: 0 };
  const [clock] = await tx.execute<{ v: string }>(
    sql`select (extract(epoch from clock_timestamp()) * 1000000)::bigint::text as v`,
  );
  const version = Math.max(Number(clock?.v ?? 0), (prev?.version ?? 0) + 1);
  const { rows } = await warehouse.writeEvent(scope, snapshot, version);
  await tx
    .insert(eventSync)
    .values({
      orgId,
      eventId,
      adapter: warehouse.name,
      hash,
      version,
      timeZone: snapshot.timeZone,
      syncedAt: scope.ctx.now,
    })
    .onConflictDoUpdate({
      target: [eventSync.orgId, eventSync.adapter, eventSync.eventId],
      set: { hash, version, timeZone: snapshot.timeZone, syncedAt: scope.ctx.now, updatedAt: sql`now()` },
    });
  return { written: true, rows };
}
