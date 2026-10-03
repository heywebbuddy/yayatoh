import type { ORG_ROLES } from '../schema.ts';

export type OrgRole = (typeof ORG_ROLES)[number];

/** Org-level permissions. Event-scoped roles arrive with events (M1.4). */
export const PERMISSIONS = [
  'org:read',
  'org:update',
  'members:read',
  'members:manage',
  'billing:read',
  'events:read',
  'events:write',
  'orders:read',
  'orders:refund',
  /** Record box-office sales the organizer collected themselves (cash, Zelle, card terminal). */
  'orders:sell',
  /** Add internal notes to an order (M3.10b support timeline). */
  'orders:note',
  /** Buyer support (M1.5f): revoke a buyer's order link and send them a new one. */
  'orders:support',
  'attendees:read',
  /** Label, tag and (later) edit attendees. */
  'attendees:write',
  /** Download attendee lists (CSV). Contact data leaving the platform: narrower than read. */
  'attendees:export',
  /**
   * Include private answers (dietary, accessibility, private RSVP questions; P4-3) in a guest
   * answers export (M4.1e). Owners and admins; co-hosts on their event (`attendees:*`).
   */
  'attendees:export_private',
  'contacts:read',
  /** Merge duplicate contacts and undo merges (M6.1a): moves orders, tickets and history. */
  'contacts:merge',
  'finance:read',
  /** Resolve reconciliation differences (M1.6e). */
  'finance:reconcile',
  /** Review, edit and submit dispute evidence for the org's own disputes (M1.6e). */
  'disputes:respond',
  /** Refund outside the event's refund policy, with a note (M1.6e). Owners and admins. */
  'orders:refund_override',
  /** Connect and change the payout account (KYC, bank). Money leaving the platform. */
  'payouts:manage',
  /** Tracked links and their clicks, attributed orders and revenue (M3.8a). */
  'marketing:read',
  'marketing:write',
  'checkin:scan',
  /**
   * Door supervisor (M3.4a): every device of the org in the Scan PWA, force a sync, switch a
   * device's entrance, revoke a device (step-up), and receive device alerts.
   */
  'checkin:supervise',
  /** Put a device into kiosk mode (self check-in locked to one entrance, PIN to exit; M3.4a). */
  'checkin:kiosk',
  /** Create and revoke org API keys (/v1). */
  'api_keys:manage',
  /** Read the organizer inbox (conversations with customers) and the announcement log. */
  'messages:read',
  /** Send announcements and replies, block and report conversations. */
  'messages:send',
  /** Settings → Activity: the org's audit log and its export (M1.14b). Owners and admins. */
  'audit:read',
  /** Data-subject requests: find, export and erase a person's data (M1.14c). Owners and admins. */
  'privacy:manage',
  /** Change an event's seating (plans, assignments, rules, seat finder). Event-scoped for planners (M4.2a). */
  'seating:write',
  /** See an event's team (co-hosts, planners, pending event invitations) (M4.2a). */
  'event_team:read',
  /** Invite, change and remove an event's co-hosts and planners (M4.2a). */
  'event_team:manage',
  /** See an event's parties and guests, with their private answers (M4.1a guests module). */
  'guests:read',
  /** Add, change, move and remove parties and guests (M4.1a). Event-scoped for co-hosts and planners. */
  'guests:write',
  /** Acknowledge and snooze Command Center alerts (M3.2b). Viewers and scanners only see them. */
  'alerts:manage',
  /** See an event's help requests (M3.3b guest assistance queue): guests' notes are staff-only. */
  'assistance:read',
  /** Take, assign, start, resolve and cancel help requests, and add notes (M3.3b). */
  'assistance:manage',
  /** See a gala's purchased tables, their buyers and named guests (M4.2b Tables & Sponsors). */
  'tables:read',
  /** Name a purchased table's guests by hand and send naming reminders (M4.2b). */
  'tables:write',
  /** Create and delete sandbox orgs linked to this org (M6.3a). Owners and admins. */
  'sandbox:manage',
  /** Webhook endpoints, their signing secrets, test sends and replays (M6.3b). Owners and admins. */
  'webhooks:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS;
export const ROLE_PERMISSIONS: Readonly<Record<OrgRole, readonly Permission[]>> = {
  owner: ALL,
  admin: ALL,
  manager: [
    'org:read',
    'members:read',
    'events:read',
    'events:write',
    'seating:write',
    'event_team:read',
    'orders:read',
    'orders:sell',
    'orders:support',
    'orders:note',
    'attendees:read',
    'guests:read',
    'attendees:write',
    'guests:write',
    'attendees:export',
    'contacts:read',
    'contacts:merge',
    'marketing:read',
    'marketing:write',
    'checkin:scan',
    'checkin:supervise',
    'checkin:kiosk',
    'messages:read',
    'messages:send',
    'alerts:manage',
    'assistance:read',
    'assistance:manage',
    'tables:read',
    'tables:write',
  ],
  finance: [
    'org:read',
    'billing:read',
    'events:read',
    'orders:read',
    'orders:refund',
    'orders:note',
    'finance:read',
    'finance:reconcile',
    'disputes:respond',
    'payouts:manage',
    'marketing:read',
    'alerts:manage',
  ],
  marketing: [
    'org:read',
    'events:read',
    'contacts:read',
    'marketing:read',
    'marketing:write',
    'messages:read',
    'messages:send',
  ],
  box_office: [
    'org:read',
    'events:read',
    'orders:read',
    'orders:sell',
    'orders:support',
    'orders:note',
    'attendees:read',
    'guests:read',
    'attendees:write',
    'guests:write',
    'checkin:scan',
    'checkin:kiosk',
    'messages:read',
    'alerts:manage',
    'assistance:read',
    'assistance:manage',
    'tables:read',
    'tables:write',
  ],
  scanner: ['org:read', 'checkin:scan', 'assistance:read', 'assistance:manage'],
  viewer: [
    'org:read',
    'members:read',
    'events:read',
    'orders:read',
    'attendees:read',
    'guests:read',
    'marketing:read',
    'event_team:read',
    'assistance:read',
    'tables:read',
  ],
  /**
   * M4.2a: someone who works on specific events only (a co-host or planner invited to one event).
   * Org-wide they may only read the org's name; everything else comes from their event roles, for
   * those events alone. The console shows them just their events.
   */
  collaborator: ['org:read'],
};

/** Org roles an admin can grant directly (a collaborator comes only from an event invitation). */
export const GRANTABLE_ORG_ROLES = [
  'owner',
  'admin',
  'manager',
  'finance',
  'marketing',
  'box_office',
  'scanner',
  'viewer',
] as const satisfies readonly OrgRole[];

/** Platform permissions are not granted by org roles; they need a platform actor. */
export const PLATFORM_PERMISSIONS = [
  'platform:org.create',
  'platform:entitlements.manage',
  'platform:org.suspend',
  /** Suspend, reactivate or terminate the whole org (M1.3f). */
  'platform:org.status',
  /** Restore a terminated org (the reviewed un-termination, M1.13d; staff step-up). */
  'platform:org.restore',
  'platform:payouts.hold',
  'platform:payouts.release',
  'platform:disputes.submit',
  /** The daily reconciliation job (M1.6e). */
  'platform:payments.reconcile',
  /** Legacy URL redirects (migration tooling, roadmap §7.7). */
  'platform:redirects.manage',
] as const;

/**
 * Org roles that must use two-step verification (roadmap §10 Phase 1, decision D14): they can
 * move money, change payouts and domains, or grant access. A member holding one in any org
 * sets it up before using any console.
 */
export const TWO_FACTOR_ROLES = ['owner', 'admin', 'finance'] as const satisfies readonly OrgRole[];

export function roleRequiresTwoFactor(role: string): boolean {
  return (TWO_FACTOR_ROLES as readonly string[]).includes(role);
}

export function roleCan(role: OrgRole, permission: string): boolean {
  return (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission);
}

/**
 * What an event-scoped role (events.event_role_assignments) adds, for that one event only. It
 * applies on top of the member's org role; it never reaches other events or org-level actions.
 *
 * Entries are exact permissions or a `module:*` wildcard, so permissions a later module adds
 * (`guests:read`, `rsvp:write`, …) map to co-hosts and planners by name with no change here.
 */
export const EVENT_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  event_manager: [
    'events:read',
    'events:write',
    'seating:write',
    'orders:read',
    'orders:sell',
    'orders:support',
    'orders:note',
    'attendees:read',
    'attendees:write',
    'attendees:export',
    'checkin:scan',
    'checkin:supervise',
    'checkin:kiosk',
    'messages:read',
    'messages:send',
    'assistance:read',
    'assistance:manage',
    'tables:read',
    'tables:write',
  ],
  door_staff: ['events:read', 'checkin:scan', 'assistance:read', 'assistance:manage'],
  session_scanner: ['checkin:scan'],
  /**
   * M4.2a (P4-8), the couple or the gala chair: everything about their event, including tickets,
   * refunds and the event's own reports, and its team. Never org settings, payouts, billing,
   * members, API keys, the audit log or another event.
   */
  co_host: [
    'events:*',
    'seating:*',
    'orders:read',
    'orders:sell',
    'orders:support',
    'orders:refund',
    'attendees:*',
    'contacts:read',
    'checkin:*',
    'messages:*',
    'marketing:write',
    'finance:read',
    'event_team:*',
    'guests:*',
    'rsvp:*',
    'website:*',
    'gallery:*',
    'dayof:*',
    'tickets:*',
    'tables:*',
    'assistance:*',
  ],
  /**
   * M4.2a (P4-8): guests, RSVP, seating, website, gallery, messages and day-of for that event.
   * No orders, refunds, payouts, finance reports, exports or settings.
   */
  planner: [
    'events:read',
    'seating:*',
    'attendees:read',
    'attendees:write',
    'checkin:scan',
    'messages:read',
    'messages:send',
    'guests:*',
    'rsvp:*',
    'website:*',
    'gallery:*',
    'dayof:*',
    'assistance:*',
  ],
  /** Starts and stops kiosk mode on the event's devices (M3.4a); scans nothing themselves. */
  kiosk_operator: ['checkin:kiosk'],
};

/** Event roles that can be given by invitation from an event's Team page (M4.2a). */
export const TEAM_EVENT_ROLES = ['co_host', 'planner'] as const;
export type TeamEventRole = (typeof TEAM_EVENT_ROLES)[number];

/** Permissions that no event role ever grants, whatever its wildcards (defence in depth). */
const NEVER_EVENT_SCOPED = /^(platform|payouts|billing|members|api_keys|sandbox|webhooks|audit|privacy|org):/;

function grants(entry: string, permission: string): boolean {
  if (entry === permission) return true;
  return entry.endsWith(':*') && permission.startsWith(entry.slice(0, -1));
}

export function eventRoleCan(roles: readonly string[], permission: string): boolean {
  if (NEVER_EVENT_SCOPED.test(permission)) return false;
  return roles.some((r) => EVENT_ROLE_PERMISSIONS[r]?.some((e) => grants(e, permission)) ?? false);
}

/**
 * Event console sections (nav keys) each team role may open (M4.2a). `null` = every section the
 * event's profile shows. Members with an org role keep what their org role gives.
 */
export const EVENT_ROLE_SECTIONS: Readonly<Record<TeamEventRole, readonly string[] | null>> = {
  co_host: null,
  planner: ['home', 'guests', 'rsvp', 'seating', 'seatFinder', 'website', 'gallery', 'messages', 'dayOf'],
};

/** Whether event roles open a console section: any team role that lists it (or lists all). */
export function eventRolesOpenSection(roles: readonly string[], section: string): boolean {
  return roles.some((r) => {
    if (!(TEAM_EVENT_ROLES as readonly string[]).includes(r)) return false;
    const s = EVENT_ROLE_SECTIONS[r as TeamEventRole];
    return s === null || s.includes(section);
  });
}
