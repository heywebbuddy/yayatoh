import type { TenantTx } from '@yayatoh/db';
import { asc, eq, inArray, lt } from 'drizzle-orm';
import { admissions, checkpoints, scans } from './schema.ts';

/**
 * When a person's tickets were admitted (M1.14c access requests). Admissions and scans hold no
 * personal data themselves (ticket ids only), so erasure keeps them: once the tickets are
 * redacted they no longer point at anyone.
 */
export async function admissionsDsarTx(tx: TenantTx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  const rows = await tx
    .select({
      ticketId: admissions.ticketId,
      eventId: admissions.eventId,
      day: admissions.day,
      admittedAt: admissions.admittedAt,
      undoneAt: admissions.undoneAt,
      checkpoint: checkpoints.name,
    })
    .from(admissions)
    .leftJoin(checkpoints, eq(checkpoints.id, admissions.checkpointId))
    .where(inArray(admissions.ticketId, [...ticketIds]))
    .orderBy(asc(admissions.admittedAt));
  return rows;
}

/**
 * Retention: the scan log (every attempt, with device and timing) is kept 12 months (roadmap §10).
 * Admissions stay: they are the check-in counts and hold no personal data.
 */
export async function purgeScansBeforeTx(tx: TenantTx, before: Date): Promise<number> {
  return (await tx.delete(scans).where(lt(scans.scannedAt, before)).returning({ id: scans.id })).length;
}
