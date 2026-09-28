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
  'attendees:read',
  /** Label, tag and (later) edit attendees. */
  'attendees:write',
  /** Download attendee lists (CSV). Contact data leaving the platform: narrower than read. */
  'attendees:export',
  'contacts:read',
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
    'orders:read',
    'orders:sell',
    'attendees:read',
    'attendees:write',
    'attendees:export',
    'contacts:read',
    'marketing:read',
    'marketing:write',
    'checkin:scan',
    'messages:read',
    'messages:send',
  ],
  finance: [
    'org:read',
    'billing:read',
    'events:read',
    'orders:read',
    'orders:refund',
    'finance:read',
    'finance:reconcile',
    'disputes:respond',
    'payouts:manage',
    'marketing:read',
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
    'attendees:read',
    'attendees:write',
    'checkin:scan',
    'messages:read',
  ],
  scanner: ['org:read', 'checkin:scan'],
  viewer: ['org:read', 'members:read', 'events:read', 'orders:read', 'attendees:read', 'marketing:read'],
};

/** Platform permissions are not granted by org roles; they need a platform actor. */
export const PLATFORM_PERMISSIONS = [
  'platform:org.create',
  'platform:entitlements.manage',
  'platform:org.suspend',
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
 */
export const EVENT_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  event_manager: [
    'events:read',
    'events:write',
    'orders:read',
    'orders:sell',
    'attendees:read',
    'attendees:write',
    'attendees:export',
    'checkin:scan',
    'messages:read',
    'messages:send',
  ],
  door_staff: ['events:read', 'checkin:scan'],
  session_scanner: ['checkin:scan'],
};

export function eventRoleCan(roles: readonly string[], permission: string): boolean {
  return roles.some((r) => EVENT_ROLE_PERMISSIONS[r]?.includes(permission) ?? false);
}
