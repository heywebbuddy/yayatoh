import type { TenantTx } from '@yayatoh/db';
import { and, count, eq, min } from 'drizzle-orm';
import { registrants, sessionEnrollments } from './schema.ts';

/**
 * M5.9a conference Command Center pack: registration's counts for the alert rules and widgets
 * (counts only, inside the caller's tenant transaction; no names, no addresses).
 */

/** How many people wait in each session's line (session id → waiting), sessions with a line only. */
export async function sessionWaitlistsTx(tx: TenantTx, eventId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ sessionId: sessionEnrollments.sessionId, n: count() })
    .from(sessionEnrollments)
    .where(and(eq(sessionEnrollments.eventId, eventId), eq(sessionEnrollments.status, 'waiting')))
    .groupBy(sessionEnrollments.sessionId);
  return new Map(rows.map((r) => [r.sessionId, Number(r.n)]));
}

/** Applications waiting for a decision (M5.1c `pending`), and when the oldest one came in. */
export async function approvalBacklogTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ pending: number; oldestAt: Date | null }> {
  const [r] = await tx
    .select({ n: count(), oldest: min(registrants.createdAt) })
    .from(registrants)
    .where(and(eq(registrants.eventId, eventId), eq(registrants.status, 'pending')));
  return { pending: Number(r?.n ?? 0), oldestAt: r?.oldest ?? null };
}

/**
 * Registrations at a glance (agreement §6, the Command Center's tickets tile): confirmed
 * registrants, and applications or unpaid places still in progress (pending, approved, reserved).
 */
export async function registrationCountsTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ confirmed: number; inProgress: number }> {
  const rows = await tx
    .select({ status: registrants.status, n: count() })
    .from(registrants)
    .where(eq(registrants.eventId, eventId))
    .groupBy(registrants.status);
  const n = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return { confirmed: n('confirmed'), inProgress: n('pending') + n('approved') + n('reserved') };
}
