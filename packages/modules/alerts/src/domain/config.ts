import { DELIVERABILITY_THRESHOLDS } from '@yayatoh/notifications/deliverability';

/**
 * The alert engine's catalogue (M3.2b): rules, what each one measures, who may see it, the
 * console page that fixes it, and the thresholds. Thresholds are the roadmap's defaults (M3.2),
 * pending the owner (docs/owner-inbox.md → "Alert thresholds"). Pure: no I/O.
 */

export const ALERT_STATES = ['open', 'acknowledged', 'snoozed', 'resolved'] as const;
export type AlertState = (typeof ALERT_STATES)[number];
/** Alerts that still need someone: everything but resolved. */
export const ACTIVE_STATES = ['open', 'acknowledged', 'snoozed'] as const satisfies readonly AlertState[];

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Routing groups: members choose channels per group (by role, `alerts.routing`). */
export const ALERT_CATEGORIES = [
  'attendees',
  'payments',
  'door',
  'sales',
  'setup',
  'messaging',
  // M5.9a: the conference pack (sessions, exhibitors, speakers, sponsors).
  'conference',
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

/** Where an alert can reach a member besides the alerts page. */
export const ROUTING_CHANNELS = ['in_app', 'email', 'sms', 'push'] as const;
export type RoutingChannel = (typeof ROUTING_CHANNELS)[number];

export const HISTORY_ACTIONS = [
  'fired',
  'updated',
  'acknowledged',
  'snoozed',
  'woke',
  'ack_expired',
  'resolved',
  'reopened',
  'notified',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export const RULE_KEYS = [
  'unseated',
  'undistributed',
  'paymentsFailed',
  'paymentsStuck',
  'refundSurge',
  'devicesOffline',
  'devicesLowBattery',
  'devicesBacklog',
  'capacityNear',
  'capacityFull',
  'sellOut',
  'salesPace',
  'readiness',
  // M3.3b guest assistance: help requests nobody has taken within their SLA.
  'assistanceOverdue',
  'domain',
  'payoutsPastDue',
  'deliverability',
  'automationFailed',
  // Batch 3e merge: failed campaign sends (M3.6b) and dispute evidence deadlines (M3.10c).
  'campaignFailed',
  'disputeDeadline',
  // M4.8e: pledges still unpaid 14 days after the event (P4-12).
  'pledgesUnpaid',
  // M5.9a conference pack: sessions, exhibitors, speakers, sponsors, onsite stations, approvals and invoices.
  'sessionsNearCapacity',
  'sessionWaitlists',
  'roomsTooSmall',
  'exhibitorsNoLeads',
  'exhibitorsNoStaff',
  'speakerTasksOverdue',
  'deliverablesOverdue',
  'printersKiosksOffline',
  'approvalBacklog',
  'invoicesOverdue',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface RuleDef {
  readonly key: RuleKey;
  /** Event rules are evaluated per event (grouped by rule + event); org rules once per org. */
  readonly scope: 'event' | 'org';
  readonly category: AlertCategory;
  /** Who may see the alert (and so be told about it). */
  readonly permission: string;
  /**
   * The console page (org-relative) with the bulk action or screen that fixes it; `{event}` is
   * the event's slug. The label is `alerts.fix.<key>` in the web messages.
   */
  readonly fix: string;
}

const rule = (
  key: RuleKey,
  scope: 'event' | 'org',
  category: AlertCategory,
  permission: string,
  fix: string,
): RuleDef => ({ key, scope, category, permission, fix });

export const RULES: Readonly<Record<RuleKey, RuleDef>> = {
  unseated: rule('unseated', 'event', 'attendees', 'attendees:read', '/e/{event}/seating/assign'),
  undistributed: rule(
    'undistributed',
    'event',
    'attendees',
    'attendees:read',
    '/e/{event}/attendees?distribution=pending',
  ),
  paymentsFailed: rule(
    'paymentsFailed',
    'event',
    'payments',
    'orders:read',
    '/e/{event}/analysis/bookings?filter=failed',
  ),
  paymentsStuck: rule(
    'paymentsStuck',
    'event',
    'payments',
    'orders:read',
    '/e/{event}/analysis/bookings?filter=pending',
  ),
  refundSurge: rule(
    'refundSurge',
    'event',
    'payments',
    'orders:read',
    '/e/{event}/analysis/bookings?filter=refunded',
  ),
  devicesOffline: rule('devicesOffline', 'event', 'door', 'events:read', '/e/{event}/onsite'),
  devicesLowBattery: rule('devicesLowBattery', 'event', 'door', 'events:read', '/e/{event}/onsite'),
  devicesBacklog: rule('devicesBacklog', 'event', 'door', 'events:read', '/e/{event}/onsite'),
  capacityNear: rule('capacityNear', 'event', 'door', 'events:read', '/e/{event}/onsite'),
  capacityFull: rule('capacityFull', 'event', 'door', 'events:read', '/e/{event}/onsite'),
  sellOut: rule('sellOut', 'event', 'sales', 'orders:read', '/e/{event}/tickets-orders'),
  salesPace: rule('salesPace', 'event', 'sales', 'orders:read', '/e/{event}/analysis'),
  readiness: rule('readiness', 'event', 'setup', 'events:read', '/e/{event}/setup-guide'),
  assistanceOverdue: rule('assistanceOverdue', 'event', 'door', 'assistance:read', '/e/{event}/assistance'),
  domain: rule('domain', 'org', 'setup', 'org:update', '/domains'),
  payoutsPastDue: rule('payoutsPastDue', 'org', 'payments', 'finance:read', '/payouts'),
  // M3.8b: the suppression list (bounced and complaining addresses) on Messaging health.
  deliverability: rule('deliverability', 'org', 'messaging', 'messages:read', '/messaging#suppressions'),
  automationFailed: rule('automationFailed', 'org', 'messaging', 'messages:read', '/messaging'),
  campaignFailed: rule('campaignFailed', 'org', 'messaging', 'marketing:read', '/campaigns'),
  disputeDeadline: rule('disputeDeadline', 'org', 'payments', 'finance:read', '/disputes'),
  pledgesUnpaid: rule('pledgesUnpaid', 'event', 'payments', 'orders:read', '/e/{event}/donations/pledges'),
  // M5.9a conference pack. Counts only; the fixing page holds the names.
  sessionsNearCapacity: rule(
    'sessionsNearCapacity',
    'event',
    'conference',
    'events:read',
    '/e/{event}/sessions',
  ),
  sessionWaitlists: rule(
    'sessionWaitlists',
    'event',
    'conference',
    'events:read',
    '/e/{event}/registration/enrollment',
  ),
  roomsTooSmall: rule('roomsTooSmall', 'event', 'conference', 'events:read', '/e/{event}/sessions'),
  exhibitorsNoLeads: rule('exhibitorsNoLeads', 'event', 'conference', 'events:read', '/e/{event}/exhibitors'),
  exhibitorsNoStaff: rule(
    'exhibitorsNoStaff',
    'event',
    'conference',
    'events:read',
    '/e/{event}/exhibitors/portal',
  ),
  speakerTasksOverdue: rule(
    'speakerTasksOverdue',
    'event',
    'conference',
    'events:read',
    '/e/{event}/speakers/tasks',
  ),
  deliverablesOverdue: rule(
    'deliverablesOverdue',
    'event',
    'conference',
    'events:read',
    '/e/{event}/sponsors',
  ),
  printersKiosksOffline: rule('printersKiosksOffline', 'event', 'door', 'events:read', '/e/{event}/onsite'),
  approvalBacklog: rule(
    'approvalBacklog',
    'event',
    'attendees',
    'attendees:read',
    '/e/{event}/registration/applications',
  ),
  invoicesOverdue: rule(
    'invoicesOverdue',
    'event',
    'payments',
    'orders:read',
    '/e/{event}/registration/invoices',
  ),
};

export const isRuleKey = (v: string): v is RuleKey => (RULE_KEYS as readonly string[]).includes(v);

/** The fixing page of a rule for an event (org-relative). */
export function fixPath(key: RuleKey, eventSlug: string | null): string {
  const path = RULES[key].fix;
  return eventSlug ? path.replace('{event}', eventSlug) : path;
}

/** Roadmap defaults (M3.2), pending the owner. Times in ms, rates in basis points. */
export const THRESHOLDS = {
  /** Any active attendee without a seat at a seated event. */
  unseatedMin: 1,
  /** Undistributed tickets: at least 10, or at least 5 % of the event's tickets (roadmap). */
  undistributedMin: 10,
  undistributedPct: 5,
  /** Failed payments not retried: warning from 3, critical from 25. */
  failedMin: 3,
  failedCritical: 25,
  /** A payment started this long ago that neither succeeded nor failed is stuck. */
  stuckAfterMs: 30 * 60_000,
  stuckMin: 1,
  /** At least 10 refunds within an hour. */
  refundWindowMs: 60 * 60_000,
  refundSurgeMin: 10,
  /** Devices count as in use for an event when seen within 12 hours. */
  deviceInUseMs: 12 * 3_600_000,
  lowBatteryPct: 15,
  /** Scans waiting on a device to sync. */
  backlogScans: 50,
  /** Admitted people over capacity (live only): near at 95 %, full at 100 %. */
  capacityNearPct: 95,
  capacityFullPct: 100,
  /** Tickets sold over capacity. */
  sellOutPct: 90,
  /** Sales pace at or below 70 % of the target's straight line, once 20 % of the run is behind us. */
  paceMaxPct: 70,
  paceMinElapsedPct: 20,
  /** Readiness blockers are raised in the last 7 days; critical in the last 24 hours. */
  readinessWindowMs: 7 * 86_400_000,
  readinessCriticalMs: 86_400_000,
  /** A live custom domain without a certificate after 24 hours. */
  sslGraceMs: 24 * 3_600_000,
  /**
   * Email over 7 days, from 100 sent: bounces ≥ 5 %, complaints ≥ 0.1 % — for the org, and (M3.8b)
   * each sending domain and each campaign. One source with the deliverability report.
   */
  deliverabilityWindowMs: DELIVERABILITY_THRESHOLDS.windowMs,
  deliverabilityMinSent: DELIVERABILITY_THRESHOLDS.minSent,
  bounceBps: DELIVERABILITY_THRESHOLDS.bounceBps,
  complaintBps: DELIVERABILITY_THRESHOLDS.complaintBps,
  /** Failed messages, bulk actions or journey steps (M3.7a) in the last 24 hours. */
  automationWindowMs: 86_400_000,
  automationMin: 1,
  /** A campaign send that failed (M3.6b) in the last 24 hours (the same window). */
  campaignFailedMin: 1,
  /** Open disputes whose evidence is due within 3 days; critical within 1 day (M3.10c levels). */
  disputeSoonMs: 72 * 3_600_000,
  disputeCriticalMs: 24 * 3_600_000,
  /** M5.9a: a session is nearly full at 95 % of its places (enrolled, or in the room while it runs). */
  sessionNearPct: 95,
  /** M5.9a: a session's line is long when more than this many people wait in it. */
  waitlistMax: 10,
  /** M5.9a: exhibitors without people are raised in the last 7 days before the event (and during it). */
  exhibitorStaffWindowMs: 7 * 86_400_000,
  /** M5.9a: applications waiting: from 10, or any one waiting longer than 48 hours. */
  approvalBacklogMin: 10,
  approvalWaitMs: 48 * 3_600_000,
  /** Acknowledged alerts still firing are raised again after 60 minutes (10 when live-critical). */
  ackTimeoutMs: 60 * 60_000,
  liveCriticalAckTimeoutMs: 10 * 60_000,
  /** Snooze choices offered in the console. */
  snoozeMinutes: [60, 240, 1440],
} as const;

/** Event modes (roadmap M3.2): planning → pre_show (T−24 h) → live (doors −2 h to end +2 h) → wrap. */
export type EventMode = 'planning' | 'pre_show' | 'live' | 'wrap';

export function eventMode(now: Date, startsAt: Date, endsAt: Date): EventMode {
  const t = now.getTime();
  if (t > endsAt.getTime() + 2 * 3_600_000) return 'wrap';
  if (t >= startsAt.getTime() - 2 * 3_600_000) return 'live';
  if (t >= startsAt.getTime() - 24 * 3_600_000) return 'pre_show';
  return 'planning';
}

/** How often an event is evaluated in each mode (roadmap §5.2: 5 min, 1 min, 15–30 s). */
export const EVALUATE_EVERY_MS: Readonly<Record<EventMode, number>> = {
  planning: 5 * 60_000,
  pre_show: 60_000,
  live: 30_000,
  wrap: 5 * 60_000,
};

/**
 * Default routing by role (who hears about which group, on which channels), used until an owner
 * or admin saves their own. In-app is how the alerts page's badge and the inbox find people.
 * Pending the owner (docs/owner-inbox.md).
 */
export const DEFAULT_ROUTING: Readonly<
  Record<string, Partial<Record<AlertCategory, readonly RoutingChannel[]>>>
> = {
  owner: {
    attendees: ['in_app', 'email'],
    payments: ['in_app', 'email', 'push'],
    door: ['in_app', 'email', 'sms', 'push'],
    sales: ['in_app', 'email'],
    setup: ['in_app', 'email'],
    messaging: ['in_app', 'email'],
    conference: ['in_app', 'email'],
  },
  admin: {
    attendees: ['in_app', 'email'],
    payments: ['in_app', 'email', 'push'],
    door: ['in_app', 'email', 'push'],
    sales: ['in_app', 'email'],
    setup: ['in_app', 'email'],
    messaging: ['in_app', 'email'],
    conference: ['in_app', 'email'],
  },
  manager: {
    attendees: ['in_app', 'email', 'push'],
    door: ['in_app', 'sms', 'push'],
    sales: ['in_app'],
    setup: ['in_app', 'email'],
    messaging: ['in_app'],
    conference: ['in_app', 'email'],
  },
  finance: { payments: ['in_app', 'email'] },
  marketing: { sales: ['in_app'], messaging: ['in_app', 'email'] },
  box_office: { attendees: ['in_app'], door: ['in_app', 'push'] },
  scanner: {},
  viewer: {},
};

/** The channels a role gets for a group, given saved rows (role → group → channels) over the defaults. */
export function routeFor(
  saved: ReadonlyMap<string, readonly RoutingChannel[]>,
  role: string,
  category: AlertCategory,
): readonly RoutingChannel[] {
  return saved.get(`${role}:${category}`) ?? DEFAULT_ROUTING[role]?.[category] ?? [];
}
