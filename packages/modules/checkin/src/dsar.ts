import type { TenantTx } from '@yayatoh/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { admissions, checkpoints } from './schema.ts';

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
