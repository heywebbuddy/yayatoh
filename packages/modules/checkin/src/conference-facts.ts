import type { TenantTx } from '@yayatoh/db';
import { and, count, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { DEVICE_ONLINE_WINDOW_MS } from './devices.ts';
import { devices, sessionAttendance } from './schema.ts';

/**
 * M5.9a conference Command Center pack: check-in's counts for the alert rules and widgets
 * (counts only, inside the caller's tenant transaction).
 */

/**
 * Kiosks (M3.4a kiosk mode) locked to this event that have gone quiet: seen within `inUseWindowMs`
 * but not within the online window (90 s), not revoked or wiped.
 */
export async function kiosksOfflineTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
  inUseWindowMs: number,
): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(devices)
    .where(
      and(
        eq(devices.mode, 'kiosk'),
        eq(devices.kioskEventId, eventId),
        isNull(devices.revokedAt),
        isNull(devices.wipeRequestedAt),
        lt(devices.lastSeenAt, new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS)),
        gte(devices.lastSeenAt, new Date(now.getTime() - inUseWindowMs)),
      ),
    );
  return Number(r?.n ?? 0);
}

/** People in each session's room now (door scans in without a scan out; flyer check-ins hold no seat). */
export async function sessionsInRoomTx(tx: TenantTx, eventId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ sessionId: sessionAttendance.sessionId, n: count() })
    .from(sessionAttendance)
    .where(
      and(
        eq(sessionAttendance.eventId, eventId),
        isNull(sessionAttendance.outAt),
        sql`${sessionAttendance.source} <> 'self'`,
      ),
    )
    .groupBy(sessionAttendance.sessionId);
  return new Map(rows.map((r) => [r.sessionId, Number(r.n)]));
}
