import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTING,
  eventMode,
  fixPath,
  RULE_KEYS,
  RULES,
  routeFor,
  THRESHOLDS,
} from '../src/domain/config.ts';
import { type EventFacts, evaluateEventRules, evaluateOrgRules, type OrgFacts } from '../src/domain/rules.ts';

const HOUR = 3_600_000;
const now = new Date('2030-05-01T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

const quiet: EventFacts = {
  startsAt: at(10 * 24 * HOUR),
  endsAt: at(10 * 24 * HOUR + 4 * HOUR),
  status: 'published',
  publishedAt: at(-10 * 24 * HOUR),
  unseated: null,
  undistributed: 0,
  activeTickets: 200,
  failedPayments: 0,
  stuckPayments: 0,
  recentRefunds: 0,
  devicesOffline: 0,
  devicesLowBattery: 0,
  devicesBacklog: 0,
  capacity: 1000,
  sold: 200,
  admitted: 0,
  salesTarget: null,
  ticketTypes: 2,
  assistanceOverdue: 0,
  assistanceUrgent: 0,
};
const live: Partial<EventFacts> = { startsAt: at(-HOUR), endsAt: at(3 * HOUR) };
const fired = (f: Partial<EventFacts>, when = now) => evaluateEventRules({ ...quiet, ...f }, when);

describe('event modes (venue-independent instants)', () => {
  it('planning → pre-show (T−24 h) → live (−2 h to end +2 h) → wrap', () => {
    const s = at(0);
    const e = at(4 * HOUR);
    expect(eventMode(at(-25 * HOUR), s, e)).toBe('planning');
    expect(eventMode(at(-24 * HOUR), s, e)).toBe('pre_show');
    expect(eventMode(at(-2 * HOUR), s, e)).toBe('live');
    expect(eventMode(at(6 * HOUR), s, e)).toBe('live');
    expect(eventMode(at(6 * HOUR + 1), s, e)).toBe('wrap');
  });
});

describe('event rules (M3.2b thresholds)', () => {
  it('a quiet event raises nothing', () => {
    expect(fired({})).toEqual({});
  });

  it('the acceptance numbers raise exactly the four alerts', () => {
    const r = fired({
      ...live,
      unseated: 37,
      undistributed: 120,
      activeTickets: 126,
      failedPayments: 14,
      devicesOffline: 3,
      sold: 126,
    });
    expect(Object.keys(r).sort()).toEqual(['devicesOffline', 'paymentsFailed', 'undistributed', 'unseated']);
    expect(r.unseated?.count).toBe(37);
    expect(r.undistributed?.count).toBe(120);
    expect(r.paymentsFailed?.count).toBe(14);
    expect(r.devicesOffline).toMatchObject({ count: 3, severity: 'critical', liveCritical: true });
  });

  it('unseated only at a seated event', () => {
    expect(fired({ unseated: null }).unseated).toBeUndefined();
    expect(fired({ unseated: 0 }).unseated).toBeUndefined();
    expect(fired({ unseated: 1 }).unseated?.count).toBe(1);
  });

  it('undistributed: at least 10, or at least 5 % of the tickets', () => {
    expect(fired({ undistributed: 9, activeTickets: 1000 }).undistributed).toBeUndefined();
    expect(fired({ undistributed: 10, activeTickets: 1000 }).undistributed?.count).toBe(10);
    expect(fired({ undistributed: 5, activeTickets: 100 }).undistributed?.count).toBe(5);
    expect(fired({ undistributed: 4, activeTickets: 100 }).undistributed).toBeUndefined();
  });

  it('failed payments: from 3, critical from 25; stuck and refund surge', () => {
    expect(fired({ failedPayments: 2 }).paymentsFailed).toBeUndefined();
    expect(fired({ failedPayments: 3 }).paymentsFailed?.severity).toBe('warning');
    expect(fired({ failedPayments: 25 }).paymentsFailed?.severity).toBe('critical');
    expect(fired({ stuckPayments: 1 }).paymentsStuck?.count).toBe(1);
    expect(fired({ recentRefunds: 9 }).refundSurge).toBeUndefined();
    expect(fired({ recentRefunds: 10 }).refundSurge?.severity).toBe('critical');
  });

  it('devices only around the event: warning in pre-show, critical live', () => {
    expect(fired({ devicesOffline: 2 }).devicesOffline).toBeUndefined();
    expect(
      fired({ devicesOffline: 2, startsAt: at(20 * HOUR), endsAt: at(24 * HOUR) }).devicesOffline,
    ).toMatchObject({
      severity: 'warning',
      liveCritical: false,
    });
    const r = fired({ ...live, devicesLowBattery: 1, devicesBacklog: 2 });
    expect(r.devicesLowBattery?.count).toBe(1);
    expect(r.devicesBacklog?.count).toBe(2);
  });

  it('capacity 95 / 100 % admitted (live only); sell-out from 90 % sold', () => {
    expect(fired({ admitted: 96, capacity: 100 }).capacityNear).toBeUndefined();
    expect(fired({ ...live, admitted: 94, capacity: 100 }).capacityNear).toBeUndefined();
    expect(fired({ ...live, admitted: 95, capacity: 100 }).capacityNear?.count).toBe(95);
    const full = fired({ ...live, admitted: 100, capacity: 100 });
    expect(full.capacityFull?.severity).toBe('critical');
    expect(full.capacityNear).toBeUndefined();
    expect(fired({ sold: 899, capacity: 1000 }).sellOut).toBeUndefined();
    expect(fired({ sold: 900, capacity: 1000 }).sellOut).toMatchObject({ count: 90, severity: 'info' });
    expect(fired({ status: 'draft', sold: 1000, capacity: 1000 }).sellOut).toBeUndefined();
  });

  it('sales pace ≤ 70 % of the straight line, after 20 % of the run', () => {
    const base = {
      publishedAt: at(-3 * 24 * HOUR),
      startsAt: at(7 * 24 * HOUR),
      endsAt: at(7 * 24 * HOUR + HOUR),
    };
    // 30 % of the run: 300 of 1,000 expected.
    expect(fired({ ...base, salesTarget: 1000, sold: 210 }).salesPace?.count).toBe(70);
    expect(fired({ ...base, salesTarget: 1000, sold: 211 }).salesPace).toBeUndefined();
    expect(fired({ ...base, salesTarget: null, sold: 0 }).salesPace).toBeUndefined();
    const early = { publishedAt: at(-HOUR), startsAt: at(9 * 24 * HOUR), endsAt: at(9 * 24 * HOUR + HOUR) };
    expect(fired({ ...early, salesTarget: 1000, sold: 0 }).salesPace).toBeUndefined();
  });

  it('readiness blockers in the last week; critical in the last day', () => {
    const soon = { startsAt: at(3 * 24 * HOUR), endsAt: at(3 * 24 * HOUR + HOUR) };
    expect(fired({ ...soon, status: 'draft', ticketTypes: 0 }).readiness).toMatchObject({
      count: 2,
      severity: 'warning',
    });
    expect(fired({ ...soon, status: 'published', ticketTypes: 0 }).readiness?.count).toBe(1);
    expect(fired({ ...soon, status: 'published', ticketTypes: 1 }).readiness).toBeUndefined();
    const tomorrow = { startsAt: at(12 * HOUR), endsAt: at(14 * HOUR) };
    expect(fired({ ...tomorrow, status: 'draft' }).readiness?.severity).toBe('critical');
    expect(fired({ status: 'draft', ticketTypes: 0 }).readiness).toBeUndefined();
  });

  it('cancelled, completed and wrapped events raise nothing', () => {
    expect(fired({ status: 'cancelled', unseated: 5 })).toEqual({});
    expect(fired({ unseated: 5 }, at(11 * 24 * HOUR))).toEqual({});
  });
});

describe('org rules', () => {
  const ok: OrgFacts = {
    domainsFailed: 0,
    domainsSslPending: 0,
    primaryDomainAffected: false,
    payoutRequirementsDue: 0,
    emailsSent: 1000,
    bounced: 0,
    complained: 0,
    messagingAutoPaused: false,
    failedMessages: 0,
    failedBulkActions: 0,
    failedJourneySteps: 0,
    failedCampaignSends: 0,
    disputesDueSoon: 0,
    disputesDueCritical: 0,
  };
  it('nothing when all is well', () => expect(evaluateOrgRules(ok)).toEqual({}));
  it('domains: warning, critical for a primary host', () => {
    expect(evaluateOrgRules({ ...ok, domainsFailed: 1 }).domain?.severity).toBe('warning');
    expect(
      evaluateOrgRules({ ...ok, domainsSslPending: 1, primaryDomainAffected: true }).domain?.severity,
    ).toBe('critical');
  });
  it('deliverability: bounces ≥ 5 % or complaints ≥ 0.1 % from 100 sent; a pause is critical', () => {
    expect(evaluateOrgRules({ ...ok, bounced: 49 }).deliverability).toBeUndefined();
    expect(evaluateOrgRules({ ...ok, bounced: 50 }).deliverability?.params.bounceBps).toBe(500);
    expect(evaluateOrgRules({ ...ok, complained: 1 }).deliverability?.params.complaintBps).toBe(10);
    expect(evaluateOrgRules({ ...ok, emailsSent: 50, bounced: 10 }).deliverability).toBeUndefined();
    expect(evaluateOrgRules({ ...ok, messagingAutoPaused: true }).deliverability?.severity).toBe('critical');
  });
  it('deliverability (M3.8b): a sending domain or a campaign over a threshold raises it on its own', () => {
    const scope = (kind: 'domain' | 'campaign', sent: number, bounced: number, complained = 0) => ({
      kind,
      sent,
      bounced,
      complained,
    });
    // The org is fine overall (10 of 1000), but one campaign bounced 10 of 120.
    const f = { ...ok, bounced: 10, emailScopes: [scope('domain', 880, 0), scope('campaign', 120, 10)] };
    expect(evaluateOrgRules(f).deliverability).toMatchObject({
      severity: 'warning',
      count: 10,
      params: { bounceBps: 100, domains: 0, campaigns: 1, paused: 0 },
    });
    // A domain over on complaints (1 of 200 = 0.5 %), counted apart from campaigns.
    expect(
      evaluateOrgRules({ ...ok, complained: 1, emailsSent: 5000, emailScopes: [scope('domain', 200, 0, 1)] })
        .deliverability?.params,
    ).toMatchObject({ domains: 1, campaigns: 0 });
    // Under 100 sent, a scope's rate doesn't count.
    expect(
      evaluateOrgRules({ ...ok, emailScopes: [scope('campaign', 99, 50)] }).deliverability,
    ).toBeUndefined();
    // At the threshold exactly (5 of 100) it fires; one under doesn't.
    expect(
      evaluateOrgRules({ ...ok, emailScopes: [scope('campaign', 100, 5)] }).deliverability,
    ).toBeDefined();
    expect(
      evaluateOrgRules({ ...ok, emailScopes: [scope('campaign', 100, 4)] }).deliverability,
    ).toBeUndefined();
  });
  it('deliverability links to the suppression list', () => {
    expect(fixPath('deliverability', null)).toBe('/messaging#suppressions');
  });
  it('payouts past due and automation failures', () => {
    expect(evaluateOrgRules({ ...ok, payoutRequirementsDue: 2 }).payoutsPastDue).toMatchObject({
      count: 2,
      severity: 'critical',
    });
    expect(evaluateOrgRules({ ...ok, failedMessages: 1, failedBulkActions: 2 }).automationFailed?.count).toBe(
      3,
    );
  });
  it('batch 3e: journey steps count as automation failures; campaign sends and dispute deadlines', () => {
    expect(evaluateOrgRules({ ...ok, failedJourneySteps: 2 }).automationFailed).toMatchObject({
      count: 2,
      params: { journeys: 2 },
    });
    expect(evaluateOrgRules({ ...ok, failedCampaignSends: 1 }).campaignFailed).toMatchObject({
      count: 1,
      severity: 'warning',
    });
    expect(evaluateOrgRules({ ...ok, disputesDueSoon: 2 }).disputeDeadline?.severity).toBe('warning');
    expect(
      evaluateOrgRules({ ...ok, disputesDueSoon: 2, disputesDueCritical: 1 }).disputeDeadline,
    ).toMatchObject({ count: 2, severity: 'critical', params: { critical: 1 } });
  });
});

describe('guest assistance (M3.3b)', () => {
  it('help requests past their SLA raise one alert; critical when one is urgent, live-critical when live', () => {
    const warn = fired({ assistanceOverdue: 2, assistanceUrgent: 0 }).assistanceOverdue;
    expect(warn).toMatchObject({ severity: 'warning', count: 2, liveCritical: false });
    const crit = fired({ ...live, assistanceOverdue: 3, assistanceUrgent: 1 }).assistanceOverdue;
    expect(crit).toMatchObject({ severity: 'critical', count: 3, liveCritical: true });
    expect(crit?.params).toEqual({ count: 3, urgent: 1 });
    expect(fired({ assistanceOverdue: 0 }).assistanceOverdue).toBeUndefined();
    expect(fired({ status: 'cancelled', assistanceOverdue: 4 }).assistanceOverdue).toBeUndefined();
  });
  it('is a door alert for people who read the queue, fixed on the queue page', () => {
    expect(RULES.assistanceOverdue).toMatchObject({ category: 'door', permission: 'assistance:read' });
    expect(fixPath('assistanceOverdue', 'gala')).toBe('/e/gala/assistance');
  });
});

describe('catalogue', () => {
  it('every rule has a scope, a group, a permission and a fixing page', () => {
    for (const k of RULE_KEYS) {
      expect(RULES[k].key).toBe(k);
      expect(RULES[k].fix.startsWith('/')).toBe(true);
      expect(RULES[k].fix.includes('{event}')).toBe(RULES[k].scope === 'event');
    }
    expect(fixPath('unseated', 'gala')).toBe('/e/gala/seating/assign');
    expect(fixPath('domain', null)).toBe('/domains');
  });
  it('routing falls back to the role defaults; viewers and scanners get nothing by default', () => {
    const saved = new Map([['viewer:door', ['in_app' as const]]]);
    expect(routeFor(saved, 'viewer', 'door')).toEqual(['in_app']);
    expect(routeFor(saved, 'viewer', 'payments')).toEqual([]);
    expect(routeFor(saved, 'owner', 'payments')).toEqual(DEFAULT_ROUTING.owner?.payments);
    expect(routeFor(new Map(), 'scanner', 'door')).toEqual([]);
  });
  it('snooze choices and timeouts are the roadmap defaults', () => {
    expect(THRESHOLDS.ackTimeoutMs).toBe(HOUR);
    expect(THRESHOLDS.liveCriticalAckTimeoutMs).toBe(10 * 60_000);
    expect(THRESHOLDS.snoozeMinutes).toEqual([60, 240, 1440]);
  });
});
