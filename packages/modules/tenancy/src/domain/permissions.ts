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
  'finance:read',
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
    'marketing:write',
    'checkin:scan',
  ],
  finance: ['org:read', 'billing:read', 'events:read', 'orders:read', 'orders:refund', 'finance:read'],
  marketing: ['org:read', 'events:read', 'marketing:write'],
  box_office: ['org:read', 'events:read', 'orders:read', 'checkin:scan'],
  scanner: ['org:read', 'checkin:scan'],
  viewer: ['org:read', 'members:read', 'events:read', 'orders:read'],
};

/** Platform permissions are not granted by org roles; they need a platform actor. */
export const PLATFORM_PERMISSIONS = ['platform:org.create', 'platform:entitlements.manage'] as const;

export function roleCan(role: OrgRole, permission: string): boolean {
  return (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission);
}
