import { deliverabilityVerdict } from '@yayatoh/notifications/deliverability';
import { type EventMode, eventMode, type RuleKey, THRESHOLDS } from './config.ts';
import type { Firing } from './lifecycle.ts';

export type Thresholds = typeof THRESHOLDS;

/** Everything the event rules read about one event (gathered from the owning modules, counts only). */
export interface EventFacts {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: string;
  readonly publishedAt: Date | null;
  /** Null when the event has no published seating plan (not a seated event). */
  readonly unseated: number | null;
  readonly undistributed: number;
  readonly activeTickets: number;
  readonly failedPayments: number;
  readonly stuckPayments: number;
  readonly recentRefunds: number;
  readonly devicesOffline: number;
  readonly devicesLowBattery: number;
  readonly devicesBacklog: number;
  /** Places for sale over the live ticket types. */
  readonly capacity: number;
  /** Valid tickets. */
  readonly sold: number;
  /** Tickets admitted (not undone). */
  readonly admitted: number;
  /** The organizer's sales target in tickets, if set. */
  readonly salesTarget: number | null;
  readonly ticketTypes: number;
  /** M3.3b: help requests still unassigned past their SLA, and how many of them are urgent. */
  readonly assistanceOverdue: number;
  readonly assistanceUrgent: number;
}

/** Everything the org rules read. */
export interface OrgFacts {
  readonly domainsFailed: number;
  readonly domainsSslPending: number;
  readonly primaryDomainAffected: boolean;
  readonly payoutRequirementsDue: number;
  readonly emailsSent: number;
  readonly bounced: number;
  readonly complained: number;
  readonly messagingAutoPaused: boolean;
  /**
   * M3.8b: email per sending domain and per campaign over the same window; the rule also fires
   * when one of them crosses a threshold on its own (a bad list can hide in a healthy org).
   */
  readonly emailScopes?: ReadonlyArray<{
    readonly kind: 'domain' | 'campaign';
    readonly sent: number;
    readonly bounced: number;
    readonly complained: number;
  }>;
  readonly failedMessages: number;
  readonly failedBulkActions: number;
  /** Journey steps that failed for good (M3.7a `automations.journey_step_failed@1`). */
  readonly failedJourneySteps: number;
  /** Campaign sends that failed (M3.6b `campaigns.send_failed@1`). */
  readonly failedCampaignSends: number;
  /** Open disputes with evidence due within the warning / critical windows (M3.10c). */
  readonly disputesDueSoon: number;
  readonly disputesDueCritical: number;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.floor((part * 100) / whole) : 0);

const fire = (
  severity: Firing['severity'],
  count: number,
  params: Record<string, number> = {},
  liveCritical = false,
): Firing => ({ severity, count, params: { count, ...params }, liveCritical });

/**
 * Evaluate every event rule (pure). Returns the rules that hold now; the engine resolves the
 * others. Device and capacity rules only apply around the event (pre-show and live); cancelled,
 * completed and archived events raise nothing.
 */
export function evaluateEventRules(
  f: EventFacts,
  now: Date,
  t: Thresholds = THRESHOLDS,
): Partial<Record<RuleKey, Firing>> {
  const out: Partial<Record<RuleKey, Firing>> = {};
  if (!['draft', 'published', 'postponed'].includes(f.status)) return out;
  const mode: EventMode = eventMode(now, f.startsAt, f.endsAt);
  if (mode === 'wrap') return out;
  const live = mode === 'live';
  const around = live || mode === 'pre_show';

  if (f.unseated !== null && f.unseated >= t.unseatedMin) out.unseated = fire('warning', f.unseated);

  if (
    f.undistributed >= t.undistributedMin ||
    (f.undistributed > 0 && pct(f.undistributed, f.activeTickets) >= t.undistributedPct)
  )
    out.undistributed = fire('warning', f.undistributed, { pct: pct(f.undistributed, f.activeTickets) });

  if (f.failedPayments >= t.failedMin) {
    const critical = f.failedPayments >= t.failedCritical;
    // A payment outage (M3.3a): critical failures while the doors are open are live-critical.
    out.paymentsFailed = fire(critical ? 'critical' : 'warning', f.failedPayments, {}, critical && live);
  }
  if (f.stuckPayments >= t.stuckMin) out.paymentsStuck = fire('warning', f.stuckPayments);
  if (f.recentRefunds >= t.refundSurgeMin) out.refundSurge = fire('critical', f.recentRefunds);

  if (around) {
    if (f.devicesOffline > 0)
      out.devicesOffline = fire(live ? 'critical' : 'warning', f.devicesOffline, {}, live);
    if (f.devicesLowBattery > 0) out.devicesLowBattery = fire('warning', f.devicesLowBattery);
    if (f.devicesBacklog > 0) out.devicesBacklog = fire('warning', f.devicesBacklog);
  }

  if (live && f.capacity > 0) {
    const p = pct(f.admitted, f.capacity);
    if (p >= t.capacityFullPct) out.capacityFull = fire('critical', p, { admitted: f.admitted }, true);
    else if (p >= t.capacityNearPct) out.capacityNear = fire('warning', p, { admitted: f.admitted }, true);
  }

  if (f.capacity > 0 && f.status !== 'draft') {
    const p = pct(f.sold, f.capacity);
    if (p >= t.sellOutPct) out.sellOut = fire('info', Math.min(p, 100), { sold: f.sold });
  }

  if (f.salesTarget && f.salesTarget > 0 && f.publishedAt && f.status === 'published') {
    const run = f.startsAt.getTime() - f.publishedAt.getTime();
    const elapsed = now.getTime() - f.publishedAt.getTime();
    if (run > 0 && elapsed > 0 && now < f.startsAt) {
      const elapsedPct = Math.floor((elapsed * 100) / run);
      const expected = Math.max(1, Math.floor((f.salesTarget * elapsed) / run));
      const pace = pct(f.sold, expected);
      if (
        elapsedPct >= t.paceMinElapsedPct &&
        f.sold * 100 <= t.paceMaxPct * expected &&
        f.sold < f.salesTarget
      )
        out.salesPace = fire('warning', pace, { sold: f.sold, target: f.salesTarget, expected });
    }
  }

  // Guests or door staff waiting for help past the SLA (the queue sets the SLA per priority).
  if (f.assistanceOverdue > 0)
    out.assistanceOverdue = fire(
      f.assistanceUrgent > 0 ? 'critical' : 'warning',
      f.assistanceOverdue,
      { urgent: f.assistanceUrgent },
      live,
    );

  const untilStart = f.startsAt.getTime() - now.getTime();
  if (untilStart > 0 && untilStart <= t.readinessWindowMs) {
    const blockers = (f.status === 'draft' ? 1 : 0) + (f.ticketTypes === 0 ? 1 : 0);
    if (blockers > 0)
      out.readiness = fire(untilStart <= t.readinessCriticalMs ? 'critical' : 'warning', blockers, {
        unpublished: f.status === 'draft' ? 1 : 0,
        noTickets: f.ticketTypes === 0 ? 1 : 0,
      });
  }
  return out;
}

/** Evaluate the org rules (pure). */
export function evaluateOrgRules(f: OrgFacts, t: Thresholds = THRESHOLDS): Partial<Record<RuleKey, Firing>> {
  const out: Partial<Record<RuleKey, Firing>> = {};
  const domains = f.domainsFailed + f.domainsSslPending;
  if (domains > 0)
    out.domain = fire(f.primaryDomainAffected ? 'critical' : 'warning', domains, {
      failed: f.domainsFailed,
      ssl: f.domainsSslPending,
    });
  if (f.payoutRequirementsDue > 0) out.payoutsPastDue = fire('critical', f.payoutRequirementsDue);
  const th = {
    windowMs: t.deliverabilityWindowMs,
    minSent: t.deliverabilityMinSent,
    bounceBps: t.bounceBps,
    complaintBps: t.complaintBps,
  };
  const org = deliverabilityVerdict({ sent: f.emailsSent, bounced: f.bounced, complained: f.complained }, th);
  const scopes = f.emailScopes ?? [];
  const domainsOver = scopes.filter((s) => s.kind === 'domain' && deliverabilityVerdict(s, th).over).length;
  const campaignsOver = scopes.filter(
    (s) => s.kind === 'campaign' && deliverabilityVerdict(s, th).over,
  ).length;
  if (f.messagingAutoPaused || org.over || domainsOver > 0 || campaignsOver > 0)
    out.deliverability = fire(f.messagingAutoPaused ? 'critical' : 'warning', f.bounced + f.complained, {
      bounceBps: org.bounceBps,
      complaintBps: org.complaintBps,
      paused: f.messagingAutoPaused ? 1 : 0,
      domains: domainsOver,
      campaigns: campaignsOver,
    });
  const failures = f.failedMessages + f.failedBulkActions + f.failedJourneySteps;
  if (failures >= t.automationMin)
    out.automationFailed = fire('warning', failures, {
      messages: f.failedMessages,
      bulk: f.failedBulkActions,
      journeys: f.failedJourneySteps,
    });
  if (f.failedCampaignSends >= t.campaignFailedMin)
    out.campaignFailed = fire('warning', f.failedCampaignSends);
  if (f.disputesDueSoon > 0)
    out.disputeDeadline = fire(f.disputesDueCritical > 0 ? 'critical' : 'warning', f.disputesDueSoon, {
      critical: f.disputesDueCritical,
    });
  return out;
}
