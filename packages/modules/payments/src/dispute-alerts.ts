import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, type Notifier, tenantCommand } from '@yayatoh/platform';
import { and, asc, eq, isNotNull, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { disputes } from './schema.ts';

const HOUR = 3_600_000;
/** Evidence deadline alerts (M3.10c, pending owner): three days before, then one day before. */
export const DISPUTE_ALERT_HOURS = [72, 24] as const;

/**
 * The alert level a dispute's deadline has reached: 0 (more than three days left), 1 (three days
 * or less), 2 (one day or less, or past).
 */
export function disputeAlertLevel(evidenceDueBy: Date | null, now: Date): 0 | 1 | 2 {
  if (!evidenceDueBy) return 0;
  const left = evidenceDueBy.getTime() - now.getTime();
  if (left <= DISPUTE_ALERT_HOURS[1] * HOUR) return 2;
  if (left <= DISPUTE_ALERT_HOURS[0] * HOUR) return 1;
  return 0;
}

/**
 * Raise the evidence-deadline alerts that are due (worker, hourly; dev route in dev and CI): each
 * open dispute's deadline passing three days and then one day emits
 * `payments.dispute_deadline_approaching@1` once per level (the M3.2b alert engine consumes it
 * when it lands; today the finance team gets a notification). A dispute that jumps straight to
 * the last day raises only that alert.
 */
export const alertDisputeDeadlinesCommand = tenantCommand({
  name: 'payments.alertDisputeDeadlines',
  input: z.object({ limit: z.int().min(1).max(500).default(200) }),
  output: z.object({ alerted: z.int() }),
  entitlement: null,
  permission: 'platform:payments.dispute_alerts',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const soon = new Date(ctx.now.getTime() + DISPUTE_ALERT_HOURS[0] * HOUR);
    const due = await tx
      .select()
      .from(disputes)
      .where(
        and(
          eq(disputes.status, 'open'),
          isNotNull(disputes.evidenceDueBy),
          lt(disputes.deadlineAlertLevel, 2),
          lte(disputes.evidenceDueBy, soon),
        ),
      )
      .orderBy(asc(disputes.evidenceDueBy))
      .limit(input.limit)
      .for('update', { skipLocked: true });
    let alerted = 0;
    for (const d of due) {
      const level = disputeAlertLevel(d.evidenceDueBy, ctx.now);
      if (level <= d.deadlineAlertLevel) continue;
      const [u] = await tx
        .update(disputes)
        .set({ deadlineAlertLevel: level, updatedAt: ctx.now })
        .where(and(eq(disputes.id, d.id), lt(disputes.deadlineAlertLevel, level)))
        .returning({ id: disputes.id });
      if (!u) continue;
      const dueBy = d.evidenceDueBy ?? ctx.now;
      emit({
        type: 'payments.dispute_deadline_approaching',
        version: 1,
        aggregateType: 'dispute',
        aggregateId: d.id,
        payload: {
          orgId,
          disputeId: d.id,
          orderId: d.orderId,
          eventId: d.eventId,
          level,
          evidenceDueBy: dueBy.toISOString(),
          hoursLeft: Math.max(0, Math.floor((dueBy.getTime() - ctx.now.getTime()) / HOUR)),
          amountMinor: d.amountMinor,
          currency: d.currency,
        },
      });
      alerted += 1;
    }
    return { alerted };
  },
  audit: (_input, r) => ({
    action: 'dispute.deadline_alerts',
    targetType: 'dispute',
    targetId: null,
    data: { alerted: r.alerted },
  }),
});

/**
 * Counts for the M3.2b alert engine (batch 3e): open disputes whose evidence is due within
 * `soonMs`, and within `criticalMs` (overdue ones count in both). Counts only.
 */
export async function disputeDeadlineFactsTx(
  tx: TenantTx,
  now: Date,
  opts: { soonMs: number; criticalMs: number },
): Promise<{ soon: number; critical: number }> {
  const rows = await tx
    .select({ dueBy: disputes.evidenceDueBy })
    .from(disputes)
    .where(
      and(
        eq(disputes.status, 'open'),
        isNotNull(disputes.evidenceDueBy),
        lte(disputes.evidenceDueBy, new Date(now.getTime() + opts.soonMs)),
      ),
    );
  const critical = rows.filter((r) => r.dueBy && r.dueBy.getTime() <= now.getTime() + opts.criticalMs);
  return { soon: rows.length, critical: critical.length };
}

const DeadlinePayload = z.object({
  orgId: z.uuid(),
  disputeId: z.uuid(),
  orderId: z.uuid(),
  eventId: z.uuid(),
  level: z.int(),
  hoursLeft: z.int(),
  amountMinor: z.int(),
  currency: z.string(),
});

/** The finance team hears of an approaching evidence deadline (in-app and email), once per level. */
export function disputeDeadlineNotifier(deps: { notifier: Notifier }) {
  return defineSubscriber({
    name: 'payments.dispute-deadline-notifier',
    events: ['payments.dispute_deadline_approaching@1'],
    handle: async (tx, event) => {
      const p = DeadlinePayload.parse(event.payload);
      const [d] = await tx.select().from(disputes).where(eq(disputes.id, p.disputeId));
      if (!d) throw new DomainError('not_found');
      if (d.status !== 'open') return;
      const ev = await findEventTx(tx, p.eventId);
      await deps.notifier.notifyMembers(tx, {
        kind: 'payments.dispute-deadline',
        params: {
          eventName: ev?.name ?? '',
          amountMinor: p.amountMinor,
          currency: p.currency,
          hours: p.hoursLeft,
        },
        dedupeKey: `dispute-deadline:${p.disputeId}:${p.level}`,
        href: '/disputes',
        orderId: p.orderId,
        eventId: p.eventId,
      });
    },
  });
}
