import { assistanceOverdueTx } from '@yayatoh/assistance';
import { checkinFactsTx, deviceHealthTx } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { type EventDto, findEventTx } from '@yayatoh/events';
import { deliverabilityBreakdownTx, deliverabilityFactsTx } from '@yayatoh/notifications';
import { paymentAlertFactsTx } from '@yayatoh/orders';
import { disputeDeadlineFactsTx, payoutRequirementsPastDueTx } from '@yayatoh/payments';
import { failedBulkOperationsTx } from '@yayatoh/platform';
import { unseatedAttendeesTx } from '@yayatoh/seating';
import { domainProblemsTx } from '@yayatoh/tenancy';
import { ticketTypeStatsTx, undistributedTicketsTx } from '@yayatoh/ticketing';
import { and, eq, gte, sql } from 'drizzle-orm';
import { eventMode, THRESHOLDS } from './domain/config.ts';
import type { EventFacts, OrgFacts } from './domain/rules.ts';
import { type SignalKind, salesTargets, signals } from './schema.ts';

/**
 * Gather one event's facts from the modules that own them (counts only, under the tenant's RLS).
 * Device and admission counts are only read around the event, where their rules apply.
 */
export async function eventFactsTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
): Promise<{ event: EventDto; facts: EventFacts } | null> {
  const event = await findEventTx(tx, eventId);
  if (!event) return null;
  const mode = eventMode(now, event.startsAt, event.endsAt);
  const around = mode === 'live' || mode === 'pre_show';
  const [unseated, dist, pay, devices, types, admitted, [target], help] = await Promise.all([
    unseatedAttendeesTx(tx, eventId),
    undistributedTicketsTx(tx, eventId),
    paymentAlertFactsTx(tx, eventId, now, {
      stuckAfterMs: THRESHOLDS.stuckAfterMs,
      refundWindowMs: THRESHOLDS.refundWindowMs,
    }),
    around
      ? deviceHealthTx(tx, now, {
          inUseWindowMs: THRESHOLDS.deviceInUseMs,
          lowBatteryPct: THRESHOLDS.lowBatteryPct,
          backlogScans: THRESHOLDS.backlogScans,
        })
      : Promise.resolve({ offline: 0, lowBattery: 0, backlog: 0 }),
    ticketTypeStatsTx(tx, eventId),
    mode === 'live' ? checkinFactsTx(tx, { eventId }).then((c) => c.tickets) : Promise.resolve(0),
    tx.select({ tickets: salesTargets.tickets }).from(salesTargets).where(eq(salesTargets.eventId, eventId)),
    assistanceOverdueTx(tx, eventId, now),
  ]);
  const live = types.filter((t) => !t.archived);
  return {
    event,
    facts: {
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      publishedAt: event.publishedAt,
      unseated,
      undistributed: dist.undistributed,
      activeTickets: dist.active,
      failedPayments: pay.failed,
      stuckPayments: pay.stuck,
      recentRefunds: pay.recentRefunds,
      devicesOffline: devices.offline,
      devicesLowBattery: devices.lowBattery,
      devicesBacklog: devices.backlog,
      capacity: live.reduce((s, t) => s + t.capacity, 0),
      sold: types.reduce((s, t) => s + t.valid, 0),
      admitted,
      salesTarget: target?.tickets ?? null,
      ticketTypes: live.length,
      assistanceOverdue: help.overdue,
      assistanceUrgent: help.urgent,
    },
  };
}

/** Gather the org-level facts (domains, payout account, email deliverability, failures). */
export async function orgFactsTx(tx: TenantTx, now: Date): Promise<OrgFacts> {
  const since = new Date(now.getTime() - THRESHOLDS.automationWindowMs);
  const [domains, due, mail, breakdown, lastDay, bulk, journeys, campaigns, disputes] = await Promise.all([
    domainProblemsTx(tx, now, THRESHOLDS.sslGraceMs),
    payoutRequirementsPastDueTx(tx),
    deliverabilityFactsTx(tx, now, THRESHOLDS.deliverabilityWindowMs),
    deliverabilityBreakdownTx(tx, now, THRESHOLDS.deliverabilityWindowMs),
    deliverabilityFactsTx(tx, now, THRESHOLDS.automationWindowMs),
    failedBulkOperationsTx(tx, since),
    signalCountTx(tx, 'journey_step_failed', since),
    signalCountTx(tx, 'campaign_send_failed', since),
    disputeDeadlineFactsTx(tx, now, {
      soonMs: THRESHOLDS.disputeSoonMs,
      criticalMs: THRESHOLDS.disputeCriticalMs,
    }),
  ]);
  return {
    domainsFailed: domains.failed,
    domainsSslPending: domains.sslPending,
    primaryDomainAffected: domains.primary,
    payoutRequirementsDue: due,
    emailsSent: mail.sent,
    bounced: mail.bounced,
    complained: mail.complained,
    messagingAutoPaused: mail.autoPaused,
    emailScopes: [
      ...breakdown.domains.map((d) => ({ kind: 'domain' as const, ...d })),
      ...breakdown.campaigns.map((c) => ({ kind: 'campaign' as const, ...c })),
    ],
    failedMessages: lastDay.failed,
    failedBulkActions: bulk,
    failedJourneySteps: journeys,
    failedCampaignSends: campaigns,
    disputesDueSoon: disputes.soon,
    disputesDueCritical: disputes.critical,
  };
}

/** Signals of one kind reported since `since` (batch 3e: journey steps, campaign sends). */
async function signalCountTx(tx: TenantTx, kind: SignalKind, since: Date): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(signals)
    .where(and(eq(signals.kind, kind), gte(signals.occurredAt, since)));
  return Number(r?.n ?? 0);
}
