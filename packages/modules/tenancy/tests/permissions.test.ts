import { describe, expect, it } from 'vitest';
import {
  EVENT_ROLE_SECTIONS,
  eventRoleCan,
  eventRolesOpenSection,
  GRANTABLE_ORG_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  roleCan,
} from '../src/domain/permissions.ts';
import { ORG_ROLES } from '../src/schema.ts';

describe('org roles', () => {
  it('a scanner cannot read orders or finance, but can scan', () => {
    expect(roleCan('scanner', 'orders:read')).toBe(false);
    expect(roleCan('scanner', 'finance:read')).toBe(false);
    expect(roleCan('scanner', 'checkin:scan')).toBe(true);
  });

  it('only owner, admin and finance can refund', () => {
    const refunders = ORG_ROLES.filter((r) => roleCan(r, 'orders:refund'));
    expect(refunders.sort()).toEqual(['admin', 'finance', 'owner']);
  });

  it('box office, managers, owners and admins record organizer-collected sales; finance does not', () => {
    expect(ORG_ROLES.filter((r) => roleCan(r, 'orders:sell')).sort()).toEqual([
      'admin',
      'box_office',
      'manager',
      'owner',
    ]);
  });

  it('only owner and admin can manage members', () => {
    expect(ORG_ROLES.filter((r) => roleCan(r, 'members:manage')).sort()).toEqual(['admin', 'owner']);
  });

  it('viewers and scanners cannot acknowledge alerts; the teams that act on them can (M3.2b)', () => {
    expect(ORG_ROLES.filter((r) => roleCan(r, 'alerts:manage')).sort()).toEqual([
      'admin',
      'box_office',
      'finance',
      'manager',
      'owner',
    ]);
  });

  it('owners hold every permission', () => {
    for (const p of PERMISSIONS) expect(roleCan('owner', p)).toBe(true);
  });
});

describe('event roles: co-host and planner (M4.2a, P4-8)', () => {
  it('a collaborator (event-only) holds nothing org-wide but the org name', () => {
    expect(ROLE_PERMISSIONS.collaborator).toEqual(['org:read']);
    expect(GRANTABLE_ORG_ROLES).not.toContain('collaborator');
  });

  // The role → permission matrix. Later modules' permissions map by name (`guests:read`, …).
  const matrix: Record<string, { co_host: boolean; planner: boolean }> = {
    'events:read': { co_host: true, planner: true },
    'events:write': { co_host: true, planner: false },
    'seating:write': { co_host: true, planner: true },
    'attendees:read': { co_host: true, planner: true },
    'attendees:write': { co_host: true, planner: true },
    'attendees:export': { co_host: true, planner: false },
    'attendees:export_private': { co_host: true, planner: false },
    'checkin:scan': { co_host: true, planner: true },
    'messages:read': { co_host: true, planner: true },
    'messages:send': { co_host: true, planner: true },
    'guests:read': { co_host: true, planner: true },
    'guests:write': { co_host: true, planner: true },
    'rsvp:write': { co_host: true, planner: true },
    'website:publish': { co_host: true, planner: true },
    'gallery:moderate': { co_host: true, planner: true },
    'dayof:run': { co_host: true, planner: true },
    'tickets:write': { co_host: true, planner: false },
    'orders:read': { co_host: true, planner: false },
    'orders:sell': { co_host: true, planner: false },
    'orders:refund': { co_host: true, planner: false },
    'finance:read': { co_host: true, planner: false },
    'event_team:read': { co_host: true, planner: false },
    'event_team:manage': { co_host: true, planner: false },
    // Never, for any event role: org settings, payouts, billing, members, keys, audit, privacy.
    'org:update': { co_host: false, planner: false },
    'payouts:manage': { co_host: false, planner: false },
    'billing:read': { co_host: false, planner: false },
    'members:manage': { co_host: false, planner: false },
    'members:read': { co_host: false, planner: false },
    'api_keys:manage': { co_host: false, planner: false },
    'audit:read': { co_host: false, planner: false },
    'privacy:manage': { co_host: false, planner: false },
    'finance:reconcile': { co_host: false, planner: false },
    'disputes:respond': { co_host: false, planner: false },
    'orders:refund_override': { co_host: false, planner: false },
    'platform:org.create': { co_host: false, planner: false },
  };
  it.each(Object.entries(matrix))('%s', (permission, want) => {
    expect(eventRoleCan(['co_host'], permission)).toBe(want.co_host);
    expect(eventRoleCan(['planner'], permission)).toBe(want.planner);
  });

  it('a wildcard never grants a permission whose module name only starts the same way', () => {
    expect(eventRoleCan(['planner'], 'guestsx:read')).toBe(false);
    expect(eventRoleCan(['planner'], 'guests')).toBe(false);
  });

  it('planners open only their sections; co-hosts every section; other event roles none', () => {
    expect(EVENT_ROLE_SECTIONS.planner).toEqual([
      'home',
      'guests',
      'rsvp',
      'seating',
      'seatFinder',
      'website',
      'gallery',
      'messages',
      'dayOf',
    ]);
    for (const s of ['ticketsOrders', 'analysis', 'details', 'team', 'setupGuide', 'onsite'])
      expect(eventRolesOpenSection(['planner'], s)).toBe(false);
    for (const s of ['ticketsOrders', 'details', 'team', 'guests'])
      expect(eventRolesOpenSection(['co_host'], s)).toBe(true);
    expect(eventRolesOpenSection(['door_staff'], 'home')).toBe(false);
  });

  it('the existing event roles keep their permissions (seating:write joins event managers)', () => {
    expect(eventRoleCan(['event_manager'], 'seating:write')).toBe(true);
    expect(eventRoleCan(['door_staff'], 'events:write')).toBe(false);
    expect(ORG_ROLES.filter((r) => roleCan(r, 'seating:write')).sort()).toEqual([
      'admin',
      'manager',
      'owner',
    ]);
  });
});
