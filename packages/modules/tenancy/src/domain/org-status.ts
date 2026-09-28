import type { CommandCategory } from '@yayatoh/kernel';
import type { ORG_STATUS_ACTIONS, ORG_STATUSES } from '../schema.ts';
import type { OrgRole } from './permissions.ts';

export type OrgStatus = (typeof ORG_STATUSES)[number];
export type OrgStatusAction = (typeof ORG_STATUS_ACTIONS)[number];

/**
 * Staff status changes (M1.3f). Suspending takes the org offline and makes its console read-only;
 * reactivating undoes that; terminating closes the org for good: nothing reactivates it from the
 * console (a mistaken termination is a reviewed runbook step, not a button). No data is deleted by
 * any of them: erasure is a DSAR or retention matter.
 */
const TRANSITIONS: Readonly<Record<OrgStatusAction, { from: readonly OrgStatus[]; to: OrgStatus }>> = {
  suspend: { from: ['active', 'limited'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'active' },
  terminate: { from: ['active', 'limited', 'suspended'], to: 'terminated' },
};

/** The status an action leads to from `from`, or null when the action is not allowed there. */
export function nextOrgStatus(from: string, action: OrgStatusAction): OrgStatus | null {
  const t = TRANSITIONS[action];
  return (t.from as readonly string[]).includes(from) ? t.to : null;
}

/**
 * Where restoring a terminated org leads (the reviewed un-termination): back to the status it had
 * when it was terminated, taken from the termination's own history row. Null when the org isn't
 * terminated, or when no termination is recorded (then nothing says what to restore).
 */
export function restoredOrgStatus(
  current: string,
  termination: { readonly fromStatus: string } | null,
): OrgStatus | null {
  if (current !== 'terminated' || !termination) return null;
  const back = termination.fromStatus;
  return back === 'active' || back === 'limited' || back === 'suspended' ? back : null;
}

/** The actions staff may take from a status (the staff console offers exactly these). */
export function orgStatusActions(from: string): OrgStatusAction[] {
  return (Object.keys(TRANSITIONS) as OrgStatusAction[]).filter((a) => nextOrgStatus(from, a) !== null);
}

/** Orgs whose public pages, listings, checkout and API keys work. */
export function isOrgLive(status: string): boolean {
  return status === 'active' || status === 'limited';
}

/**
 * Writes that still go through for a suspended org: the door keeps scanning tickets already sold
 * (pending the owner), ticket holders keep managing their own tickets, people can still report or
 * block and unsubscribe, and members can clear their own notifications and preferences.
 */
const SUSPENDED_ALLOWED: ReadonlySet<string> = new Set([
  'checkin.scanTicket',
  'checkin.undoAdmission',
  'checkin.syncScans',
  'checkin.heartbeat',
  'ticketing.claimTicket',
  'ticketing.requestHolderLink',
  'ticketing.giveTicket',
]);

/** Writes that go through even for a terminated org (personal and safety actions only). */
const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([
  'notifications.markInboxRead',
  'notifications.setMyPreferences',
  'notifications.registerPushToken',
  'notifications.unsubscribe',
  'notifications.resubscribe',
  'messaging.contactBlock',
  'messaging.contactReport',
]);

export interface OrgWriteSubject {
  readonly status: string;
  /** `system` actors (staff, the worker, verified webhooks, door devices) are never refused. */
  readonly actorType: string;
  /** The actor's role in the org, when a member. */
  readonly role: OrgRole | null;
  readonly command: string;
  readonly category?: CommandCategory;
}

/**
 * Why a write is refused for the org's status, or null when it may run. Suspended orgs are
 * read-only for everyone but the platform, except exports (organizers can still take their data
 * out) and the allowlists above. Terminated orgs refuse everything but personal and safety actions
 * and the owners' exports (pending the owner).
 */
export function orgWriteRefusal(s: OrgWriteSubject): 'org_suspended' | 'org_terminated' | null {
  if (isOrgLive(s.status) || s.actorType === 'system') return null;
  if (ALWAYS_ALLOWED.has(s.command)) return null;
  if (s.status === 'suspended') {
    if (SUSPENDED_ALLOWED.has(s.command) || s.category === 'export') return null;
    return 'org_suspended';
  }
  if (s.category === 'export' && s.role === 'owner') return null;
  return 'org_terminated';
}
