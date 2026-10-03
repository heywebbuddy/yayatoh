import { assistanceOverdueTx } from '@yayatoh/assistance';
import { checkinFactsTx, deviceHealthTx, kiosksOfflineTx, sessionsInRoomTx } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { type EventDto, findEventTx } from '@yayatoh/events';
import { deliverabilityBreakdownTx, deliverabilityFactsTx } from '@yayatoh/notifications';
import { overdueInvoicesTx, paymentAlertFactsTx } from '@yayatoh/orders';
import { disputeDeadlineFactsTx, payoutRequirementsPastDueTx } from '@yayatoh/payments';
import { failedBulkOperationsTx } from '@yayatoh/platform';
import { exhibitorStaffingTx, overdueSpeakerTasksTx, sessionFillTx } from '@yayatoh/program';
import { approvalBacklogTx, sessionWaitlistsTx } from '@yayatoh/registration';
import { unseatedAttendeesTx } from '@yayatoh/seating';
import { domainProblemsTx } from '@yayatoh/tenancy';
import { ticketTypeStatsTx, undistributedTicketsTx } from '@yayatoh/ticketing';
import { and, eq, gte, sql } from 'drizzle-orm';
import { eventMode, THRESHOLDS } from './domain/config.ts';
import type { ConferenceFacts, EventFacts, OrgFacts } from './domain/rules.ts';
import { type SignalKind, salesTargets, signals } from './schema.ts';

/**
 * M5.9a: conference facts that live in modules not on this build yet, behind ports the app
 * connects (fakes in dev and tests). Each reads inside the evaluation's tenant transaction; a
 * missing port, or one answering `null` for the event, leaves its rule quiet.
 * - `exhibitorLeads`: leads per exhibitor (M5.6b lead retrieval), exhibitor id → count.
 * - `overdueDeliverables`: open sponsor deliverables past due (M5.4b).
 * - `printersOffline`: the event's badge printers offline (M5.5b's printer watchdog).
 */
export interface ConferenceSources {
  readonly exhibitorLeads?: (tx: TenantTx, eventId: string) => Promise<ReadonlyMap<string, number> | null>;
  readonly overdueDeliverables?: (tx: TenantTx, eventId: string, now: Date) => Promise<number | null>;
  readonly printersOffline?: (tx: TenantTx, eventId: string, now: Date) => Promise<number | null>;
}

/** The conference pack's facts for one event (M5.9a), from the owning modules and the ports. */
export async function conferenceFactsTx(
  tx: TenantTx,
  event: Pick<EventDto, 'id' | 'timezone'>,
  now: Date,
  sources: ConferenceSources = {},
): Promise<ConferenceFacts> {
  const [fill, inRoom, waiting, exhibitors, tasks, kiosks, approvals, invoices] = await Promise.all([
    sessionFillTx(tx, event.id),
    sessionsInRoomTx(tx, event.id),
    sessionWaitlistsTx(tx, event.id),
    exhibitorStaffingTx(tx, event.id, now),
    overdueSpeakerTasksTx(tx, event.id, now),
    kiosksOfflineTx(tx, event.id, now, THRESHOLDS.deviceInUseMs),
    approvalBacklogTx(tx, event.id),
    overdueInvoicesTx(tx, event.id, now, event.timezone),
  ]);
  const leads = sources.exhibitorLeads ? await sources.exhibitorLeads(tx, event.id) : null;
  const t = now.getTime();
  return {
    sessions: fill.map((s) => ({
      capacity: s.capacity,
      enrolled: s.enrolled,
      roomCapacity: s.roomCapacity,
      inRoom: inRoom.get(s.sessionId) ?? 0,
      running: s.startsAt.getTime() <= t && t < s.endsAt.getTime(),
      waiting: waiting.get(s.sessionId) ?? 0,
    })),
    exhibitors: exhibitors.map((e) => ({
      people: e.people,
      leads: leads ? (leads.get(e.exhibitorId) ?? 0) : null,
    })),
    speakerTasksOverdue: tasks.assignments,
    speakersOverdue: tasks.speakers,
    deliverablesOverdue: (await sources.overdueDeliverables?.(tx, event.id, now)) ?? null,
    printersOffline: (await sources.printersOffline?.(tx, event.id, now)) ?? null,
    kiosksOffline: kiosks,
    approvalsPending: approvals.pending,
    oldestApplicationAt: approvals.oldestAt,
    invoicesOverdue: invoices,
  };
}

/**
 * Gather one event's facts from the modules that own them (counts only, under the tenant's RLS).
 * Device and admission counts are only read around the event, where their rules apply; the
 * conference pack's (M5.9a) until the event wraps.
 */
export async function eventFactsTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
  sources: ConferenceSources = {},
): Promise<{ event: EventDto; facts: EventFacts } | null> {
  const event = await findEventTx(tx, eventId);
  if (!event) return null;
  const mode = eventMode(now, event.startsAt, event.endsAt);
  const around = mode === 'live' || mode === 'pre_show';
  const active = mode !== 'wrap' && ['draft', 'published', 'postponed'].includes(event.status);
  const [unseated, dist, pay, devices, types, admitted, [target], help, conference] = await Promise.all([
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
    active ? conferenceFactsTx(tx, event, now, sources) : Promise.resolve(undefined),
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
      ...(conference ? { conference } : {}),
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
