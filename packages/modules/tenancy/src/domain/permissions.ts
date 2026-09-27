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
  'attendees:read',
  /** Label, tag and (later) edit attendees. */
  'attendees:write',
  /** Download attendee lists (CSV). Contact data leaving the platform: narrower than read. */
  'attendees:export',
  'contacts:read',
  'finance:read',
  /** Connect and change the payout account (KYC, bank). Money leaving the platform. */
  'payouts:manage',
  'marketing:write',
  'checkin:scan',
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
    'attendees:read',
    'attendees:write',
    'attendees:export',
    'contacts:read',
    'marketing:write',
    'checkin:scan',
  ],
  finance: [
    'org:read',
    'billing:read',
    'events:read',
    'orders:read',
    'orders:refund',
    'finance:read',
    'payouts:manage',
  ],
  marketing: ['org:read', 'events:read', 'contacts:read', 'marketing:write'],
  box_office: ['org:read', 'events:read', 'orders:read', 'attendees:read', 'attendees:write', 'checkin:scan'],
  scanner: ['org:read', 'checkin:scan'],
  viewer: ['org:read', 'members:read', 'events:read', 'orders:read', 'attendees:read'],
};

/** Platform permissions are not granted by org roles; they need a platform actor. */
export const PLATFORM_PERMISSIONS = ['platform:org.create', 'platform:entitlements.manage'] as const;

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
    'attendees:read',
    'attendees:write',
    'attendees:export',
    'checkin:scan',
  ],
  door_staff: ['events:read', 'checkin:scan'],
  session_scanner: ['checkin:scan'],
};

export function eventRoleCan(roles: readonly string[], permission: string): boolean {
  return roles.some((r) => EVENT_ROLE_PERMISSIONS[r]?.includes(permission) ?? false);
}
