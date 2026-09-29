/**
 * Command Center roles (roadmap M3.2 "role layouts"): the five jobs a layout is designed for.
 * They are derived from the member's org role and their event roles; they never grant anything:
 * every widget loader still checks the underlying permission as well.
 *
 * Precedence (first match wins):
 * 1. org `owner`/`admin` → owner;
 * 2. org `manager`/`box_office` → ops;
 * 3. event `event_manager` → ops;
 * 4. org `finance` → finance; org `marketing` → marketing;
 * 5. event `door_staff`/`session_scanner` → door (their job at this event wins over a generic
 *    viewer or scanner role, so door staff see the door layout, with no revenue);
 * 6. org `viewer` → ops (read-only); org `scanner` → door.
 */
export const CC_ROLES = ['owner', 'ops', 'finance', 'door', 'marketing'] as const;
export type CcRole = (typeof CC_ROLES)[number];

export function isCcRole(v: unknown): v is CcRole {
  return typeof v === 'string' && (CC_ROLES as readonly string[]).includes(v);
}

export function commandCenterRole(orgRole: string | null, eventRoles: readonly string[] = []): CcRole | null {
  if (!orgRole) return null;
  if (orgRole === 'owner' || orgRole === 'admin') return 'owner';
  if (orgRole === 'manager' || orgRole === 'box_office') return 'ops';
  if (eventRoles.includes('event_manager')) return 'ops';
  if (orgRole === 'finance') return 'finance';
  if (orgRole === 'marketing') return 'marketing';
  if (eventRoles.includes('door_staff') || eventRoles.includes('session_scanner')) return 'door';
  if (orgRole === 'viewer') return 'ops';
  if (orgRole === 'scanner') return 'door';
  return null;
}
